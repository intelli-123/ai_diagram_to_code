const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { editTerraformCode } = require('../services/geminiEditorAgent');
const { exec } = require('child_process');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

let lastGeneratedCode = '';
let lastTfFilePath = '';

const app = express();
app.use(cors());
app.use(express.static('public'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Multer setup for image upload
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

// 🧠 Gemini: Parse architecture diagram and detect cloud provider
async function processImageWithGemini(imagePath) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const imageBytes = fs.readFileSync(imagePath);
  const mimeType = 'image/png';

  const prompt = `
You are a cloud architecture parser. Your task is to extract structured cloud components and their connectivity **only** from valid IT architecture diagrams.

First, identify the primary cloud provider depicted in the diagram. Look for logos, service names (e.g., EC2, Lambda, S3 for AWS; Virtual Machine, Function App, Storage Account for Azure; Compute Engine, Cloud Function, Cloud Storage for GCP).

If the image is not a cloud or IT architecture diagram (e.g., a photo, unrelated chart, or random drawing), respond with:
{
  "error": "Invalid diagram. Only IT/cloud architecture diagrams are supported."
}

Otherwise, return a structured JSON object with three keys:
1. "cloudProvider": The identified cloud provider (case-insensitive: "aws", "azure", "gcp"). If the cloud provider cannot be confidently identified, use "Unknown".
2. "components": a list of cloud components with type, name, and properties.
3. "connections": a list of directional links showing how components are connected.

Only return valid JSON. Do not include explanations or markdown.
`;

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: imageBytes.toString('base64'),
      },
    },
  ]);

  const response = await result.response;
  return response.text();
}

// 🧩 Gemini: Generate valid Terraform code for a specific cloud provider
async function generateTerraformFromJson(jsonString, cloudProvider) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  let providerBlock = '';
  let serverlessInstructions = '';

  switch (cloudProvider.toLowerCase()) {
    case 'aws':
      providerBlock = `
terraform {
  required_version = ">= 1.0.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0.0"
    }
  }
}

provider "aws" {
  region = "us-east-1" # Default region for AWS
}
`;
      serverlessInstructions = `
For AWS Lambda functions, **always use the 'source_code' attribute** with a simple placeholder function (e.g., for Python: "def lambda_handler(event, context): return {\\"statusCode\\": 200, \\"body\\": \\"OK\\"}", or for Node.js: "exports.handler = async (event) => { return { statusCode: 200, body: JSON.stringify(\\"OK\\") }; };").
Explicitly avoid using 'filename', 's3_bucket', 's3_key', 'inline_code' blocks, or any 'data "archive_file"' blocks or 'resource "local_file"' blocks that imply local file paths for source code.
`;
      break;
    case 'azure':
      providerBlock = `
terraform {
  required_version = ">= 1.0.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0.0"
    }
  }
}

provider "azurerm" {
  features {} # Required for azurerm provider
}
`;
      serverlessInstructions = `
For Azure Function Apps (azurerm_function_app), do not include 'app_settings' that refer to local files or require deployment from local sources (e.g., WEBSITE_RUN_FROM_PACKAGE). Ensure the basic resource definition for the Function App, App Service Plan, and Storage Account is provided. Assume deployment artifacts are managed externally for validation purposes.
`;
      break;
    case 'gcp':
      providerBlock = `
terraform {
  required_version = ">= 1.0.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0.0"
    }
  }
}

provider "google" {
  project = "your-gcp-project-id" # Placeholder project ID for GCP
  region  = "us-central1"         # Default region for GCP
}
`;
      serverlessInstructions = `
For Google Cloud Functions (google_cloud_function), **always use 'source_archive_url' pointing to a dummy Google Cloud Storage (GCS) path** (e.g., "gs://your-dummy-bucket/dummy-function.zip") and ensure 'entry_point' is specified. Explicitly avoid 'source_repository' or attributes that refer to local files.
`;
      break;
    default:
      // This should ideally not be reached if cloudProvider is validated earlier
      throw new Error(`Unsupported cloud provider: ${cloudProvider}`);
  }

  const prompt = `
Generate complete, valid Terraform code for ${cloudProvider.toUpperCase()} based on this cloud architecture JSON.
The output must be valid HCL with no markdown formatting, no explanations, and no multi-line quoted strings.

***Crucial Requirement: Ensure strict adherence to each resource's and data source's supported arguments according to official Terraform documentation for the respective cloud provider. Avoid using arguments that are not explicitly defined for a specific resource type or version. For instance, 'description' is generally not an argument for 'resource "aws_cloudformation_stack"', although it might be for a data source or a different resource like 'aws_cloudformation_stack_set'. Always check the resource type and its specific argument requirements.***

${providerBlock}

${serverlessInstructions}

All string values must be on a single line. Do not split quoted strings across multiple lines. If a multi-line string is required, use heredoc syntax.

JSON:
${jsonString}
`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

// Generate unique .tf file path
function getUniqueTfFilePath() {
  const uniqueId = uuidv4().slice(0, 6);
  const filename = `generated_${uniqueId}.tf`;

  const tfDir = path.join(__dirname, '..', `generated_${uniqueId}`);
  if (!fs.existsSync(tfDir)) {
    fs.mkdirSync(tfDir, { recursive: true });
  }

  return path.join(tfDir, filename);
}

// 📸 Upload and process diagram
app.post('/upload', upload.single('diagram'), async (req, res) => {
  try {
    console.log('[DEBUG] Received diagram:', req.file.path);

    const rawGeminiResponse = await processImageWithGemini(req.file.path);
    console.log('[DEBUG] Raw Gemini response:', rawGeminiResponse);

    const cleanedRawResponse = rawGeminiResponse.replace(/```json/g, '').replace(/```/g, '').trim();

    let parsedDiagramJson;
    try {
      parsedDiagramJson = JSON.parse(cleanedRawResponse);
      console.log('[DEBUG] Parsed JSON successfully');
    } catch (err) {
      console.error('[ERROR] Failed to parse Gemini JSON response:', err);
      // If Gemini's JSON is malformed or invalid, it might be an 'error' block
      if (cleanedRawResponse.includes('"error":')) {
        return res.status(400).json({ error: cleanedRawResponse });
      }
      return res.status(500).send('Error processing diagram: Invalid JSON from AI.');
    }

    // --- Cloud Provider Detection Logic ---
    let cloudProvider = parsedDiagramJson.cloudProvider ? parsedDiagramJson.cloudProvider.toLowerCase() : 'unknown';
    const supportedProviders = ['aws', 'azure', 'gcp'];

    if (cloudProvider === 'unknown' || !supportedProviders.includes(cloudProvider)) {
        // If the user explicitly provided a cloudProvider in the query, prioritize it
        const userProvidedProvider = req.query.cloudProvider ? req.query.cloudProvider.toLowerCase() : null;

        if (userProvidedProvider && supportedProviders.includes(userProvidedProvider)) {
            cloudProvider = userProvidedProvider;
            console.log(`[INFO] AI could not detect provider, using user-specified provider: ${cloudProvider}`);
        } else if (userProvidedProvider && !supportedProviders.includes(userProvidedProvider)) {
            return res.status(400).json({
                error: `Unsupported cloud provider specified: '${userProvidedProvider}'. Supported are: ${supportedProviders.join(', ')}.`,
                action: 'Please specify a supported cloud provider in the query parameter (e.g., ?cloudProvider=aws).'
            });
        } else {
            // AI could not detect, and user did not specify
            return res.status(400).json({
                error: 'Could not confidently identify the cloud provider from the diagram.',
                action: `Please specify the cloud provider manually in the query parameter (e.g., ?cloudProvider=aws). Supported providers are: ${supportedProviders.join(', ')}.`
            });
        }
    }

    console.log(`[INFO] Detected/Using cloud provider: ${cloudProvider}`);


    // Now generate Terraform using the detected/specified cloudProvider
    let terraformCode = await generateTerraformFromJson(JSON.stringify(parsedDiagramJson, null, 2), cloudProvider);
    console.log(`[DEBUG] Terraform code generated by Gemini for ${cloudProvider}`);

    let cleanedTerraform = terraformCode;

    // --- Generic Cleanups (apply to all providers) ---
    // Remove 'resource "local_file"' blocks completely.
    cleanedTerraform = cleanedTerraform
      .replace(/resource\s+"local_file"\s+"[^"]+"\s*{[^}]*}/gs, '');
    console.log('[DEBUG] Removed local_file resources.');

    // Remove 'data "archive_file"' blocks completely.
    cleanedTerraform = cleanedTerraform
      .replace(/data\s+"archive_file"\s+"[^"]+"\s*{[^}]*}/gs, '');
    console.log('[DEBUG] Removed archive_file data sources.');

    // Remove any dynamic hash calculations that imply local files
    cleanedTerraform = cleanedTerraform
      .replace(/source_code_hash\s*=\s*filebase64sha256\(.*\)\n?/g, '');
    console.log('[DEBUG] Removed filebase64sha256 references.');

    // --- Provider-Specific Serverless Function Cleanups ---
    if (cloudProvider.toLowerCase() === 'aws') {
      cleanedTerraform = cleanedTerraform.replace(
        /(resource\s+"aws_lambda_function"\s+"[^"]+"\s*{[\s\S]*?})/g,
        (lambdaBlock) => {
          let modifiedBlock = lambdaBlock;
          let originalIndent = '';
          const indentMatch = lambdaBlock.match(/^(\s*)resource/m);
          if (indentMatch) {
              originalIndent = indentMatch[1];
          }
          const blockContentIndent = originalIndent + '  ';

          const runtimeMatch = modifiedBlock.match(/runtime\s*=\s*"(python[^"]*|node[^"]*|go[^"]*|java[^"]*|ruby[^"]*)"/);
          const runtime = runtimeMatch ? runtimeMatch[1] : 'python3.9';

          const handlerMatch = modifiedBlock.match(/handler\s*=\s*"([^"]*)"/);
          const handlerValue = handlerMatch ? handlerMatch[1] : 'handler.handler';
          const handlerFunctionName = handlerValue.split('.')[0];

          let placeholderCode;
          if (runtime.startsWith('node')) {
            placeholderCode = `exports.${handlerFunctionName} = async (event) => { return { statusCode: 200, body: JSON.stringify(\\"OK\\") }; };`;
          } else if (runtime.startsWith('python')) {
            placeholderCode = `def ${handlerFunctionName}(event, context): return {\\"statusCode\\": 200, \\"body\\": \\"OK\\"}`;
          } else {
            placeholderCode = `/* Placeholder code for ${handlerValue} */`;
          }

          modifiedBlock = modifiedBlock
            .replace(/\s*filename\s*=\s*.*?\n/g, '\n')
            .replace(/\s*inline_code\s*{[\s\S]*?}\n/g, '\n');

          if (!modifiedBlock.match(/handler\s*=\s*".*?"/)) {
              const fnNameOrRoleLineMatch = modifiedBlock.match(/(\s*)(function_name\s*=\s*".*?"|\s*role\s*=\s*[^}\n]*)/);
              let insertPoint = modifiedBlock.indexOf('{') + 1;
              let currentLineIndent = blockContentIndent;
              if (fnNameOrRoleLineMatch) {
                  insertPoint = modifiedBlock.indexOf(fnNameOrRoleLineMatch[0]) + fnNameOrRoleLineMatch[0].length;
                  currentLineIndent = fnNameOrRoleLineMatch[1] || blockContentIndent;
              }
              modifiedBlock = modifiedBlock.substring(0, insertPoint) +
                              `\n${currentLineIndent}handler          = "${handlerValue}"` +
                              modifiedBlock.substring(insertPoint);
          }

          if (!modifiedBlock.match(/source_code\s*=\s*(".*?"|<<EOF[\s\S]*?EOF)/)) {
            const lastBraceIndex = modifiedBlock.lastIndexOf('}');
            if (lastBraceIndex !== -1) {
              modifiedBlock = modifiedBlock.substring(0, lastBraceIndex) +
                              `${blockContentIndent}source_code      = "${placeholderCode}"\n` +
                              modifiedBlock.substring(lastBraceIndex);
            }
          }
          return modifiedBlock;
        }
      );
      console.log('[DEBUG] Processed aws_lambda_function resources for inline code.');
    } else if (cloudProvider.toLowerCase() === 'gcp') {
      cleanedTerraform = cleanedTerraform.replace(
        /(resource\s+"google_cloud_function"\s+"[^"]+"\s*{[\s\S]*?})/g,
        (gcpFunctionBlock) => {
          let modifiedBlock = gcpFunctionBlock;
          let originalIndent = '';
          const indentMatch = gcpFunctionBlock.match(/^(\s*)resource/m);
          if (indentMatch) {
              originalIndent = indentMatch[1];
          }
          const blockContentIndent = originalIndent + '  ';

          // Remove problematic source attributes
          modifiedBlock = modifiedBlock
            .replace(/\s*source_repository\s*=\s*.*?\n/g, '\n')
            .replace(/\s*build_environment_variables\s*=\s*.*?\n/g, '\n')
            .replace(/\s*source_archive_bucket\s*=\s*.*?\n/g, '\n')
            .replace(/\s*source_archive_object\s*=\s*.*?\n/g, '\n');

          // Ensure source_archive_url and entry_point for validation
          if (!modifiedBlock.match(/source_archive_url\s*=\s*".*?"/)) {
            const lastBraceIndex = modifiedBlock.lastIndexOf('}');
            if (lastBraceIndex !== -1) {
              modifiedBlock = modifiedBlock.substring(0, lastBraceIndex) +
                              `${blockContentIndent}source_archive_url = "gs://your-dummy-gcp-bucket/dummy-function.zip"\n` +
                              modifiedBlock.substring(lastBraceIndex);
            }
          }
          if (!modifiedBlock.match(/entry_point\s*=\s*".*?"/)) {
            const lastBraceIndex = modifiedBlock.lastIndexOf('}');
            if (lastBraceIndex !== -1) {
              modifiedBlock = modifiedBlock.substring(0, lastBraceIndex) +
                              `${blockContentIndent}entry_point        = "main"\n` +
                              modifiedBlock.substring(lastBraceIndex);
            }
          }
          return modifiedBlock;
        }
      );
      console.log('[DEBUG] Processed google_cloud_function resources for dummy source URL.');
    } else if (cloudProvider.toLowerCase() === 'azure') {
      cleanedTerraform = cleanedTerraform.replace(
        /(resource\s+"azurerm_function_app"\s+"[^"]+"\s*{[\s\S]*?})/g,
        (azureFunctionBlock) => {
          let modifiedBlock = azureFunctionBlock;
          // Remove app_settings that indicate local deployment or external zip
          modifiedBlock = modifiedBlock
            .replace(/^\s*WEBSITE_RUN_FROM_PACKAGE\s*=\s*".*?"\n?/gm, '')
            .replace(/^\s*FUNCTIONS_WORKER_RUNTIME\s*=\s*".*?"\n?/gm, '')
            .replace(/^\s*APPINSIGHTS_INSTRUMENTATIONKEY\s*=\s*.*?\n?/gm, '');

          // Remove any inline app_settings block if it only contained problematic settings
          modifiedBlock = modifiedBlock.replace(
            /(app_settings\s*=\s*{[\s\S]*?})/g,
            (appSettingsBlock) => {
              const cleanedAppSettings = appSettingsBlock
                                          .replace(/^\s*WEBSITE_RUN_FROM_PACKAGE\s*=\s*".*?"\n?/gm, '')
                                          .replace(/^\s*FUNCTIONS_WORKER_RUNTIME\s*=\s*".*?"\n?/gm, '')
                                          .replace(/^\s*APPINSIGHTS_INSTRUMENTATIONKEY\s*=\s*".*?"\n?/gm, ''); // Ensure all placeholders are removed
              if (cleanedAppSettings.trim() === 'app_settings = {}' || !/[a-zA-Z0-9_]+=/.test(cleanedAppSettings)) {
                return '';
              }
              return appSettingsBlock;
            }
          );
          return modifiedBlock;
        }
      );
      console.log('[DEBUG] Processed azurerm_function_app resources for deployment-agnostic validation.');
    }

    // --- Final General Cleanups ---
    // Fix unclosed interpolation expressions
    cleanedTerraform = cleanedTerraform
      .replace(/\$\{path\.module\s*$/gm, '${path.module}')
      .replace(/\$\{([^}]+)\n/g, (_, expr) => `\${${expr.trim()}}`);
    console.log('[DEBUG] Fixed interpolation expressions.');

    // Clean up excessive empty lines (replaces 2 or more empty lines with just one)
    cleanedTerraform = cleanedTerraform
      .replace(/(\n\s*){2,}/g, '\n\n');
    console.log('[DEBUG] Cleaned up empty lines.');

    // Final trim to remove any leading/trailing whitespace
    cleanedTerraform = cleanedTerraform.trim();

    const tfFilePath = getUniqueTfFilePath();
    fs.writeFileSync(tfFilePath, cleanedTerraform);
    console.log('[DEBUG] Cleaned & saved Terraform code to:', tfFilePath);

    // ✅ Create .tflint.hcl for linting
    const tflintConfig = `
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
`;
    const tfDir = path.dirname(tfFilePath);
    fs.writeFileSync(path.join(tfDir, '.tflint.hcl'), tflintConfig);
    console.log('[DEBUG] .tflint.hcl created');

    lastGeneratedCode = cleanedTerraform;
    lastTfFilePath = tfFilePath;

    res.type('text/plain').send(cleanedTerraform);
  } catch (err) {
    console.error('[ERROR] Failed to process image or generate Terraform code:', err);
    res.status(500).send('Error generating Terraform code');
  }
});

// 🧠 Edit Terraform code dynamically
app.post('/edit', express.json(), async (req, res) => {
  const { instruction } = req.body;
  try {
    const updatedCode = await editTerraformCode(lastGeneratedCode, instruction);
    lastGeneratedCode = updatedCode;

    if (lastTfFilePath) {
      fs.writeFileSync(lastTfFilePath, updatedCode);
      console.log('[DEBUG] Updated Terraform code saved to:', lastTfFilePath);
    }

    res.type('text/plain').send(updatedCode);
  } catch (err) {
    console.error('[ERROR] Editing failed:', err);
    res.status(500).send('Failed to edit code');
  }
});

// 🧹 Linting Endpoint
app.get('/lint', async (req, res) => {
  if (!lastTfFilePath) return res.status(400).send('No Terraform file for linting.');

  const tfDir = path.dirname(lastTfFilePath);
  const tfFilename = path.basename(lastTfFilePath);

  const cmd = `
    cd ${tfDir} &&
    terraform init -input=false -no-color &&
    terraform init -input=false -no-color -upgrade &&
    terraform validate -no-color &&
    tflint --filter=${tfFilename}
  `;

  exec(cmd, (error, stdout, stderr) => {
    let output = '';

    if (stdout) {
      output += `[STDOUT] ${stdout}\n`;
    }
    if (stderr) {
      output += `[STDERR] ${stderr}\n`;
    }

    if (error) {
      console.error('[ERROR] Linting failed:', output);
      return res.status(500).send(`Linting failed: ${output}`);
    }

    if (!output) {
      output = 'No linting issues found.';
    }

    res.type('text/plain').send(output);
  });
});

// 💰 Cost Estimation (OpenInfraQuote)
app.get('/estimate-cost', async (req, res) => {
  if (!lastTfFilePath) return res.status(400).send('No Terraform file for cost estimation.');

  const tfDir = path.dirname(lastTfFilePath);

  const cmd = `
    cd ${tfDir} &&
    curl -s https://oiq.terrateam.io/prices.csv.gz | gunzip > prices.csv
    terraform init -input=false -no-color &&
    terraform validate -no-color &&
    terraform plan -out=tf.plan -no-color &&
    terraform show -json tf.plan > tfplan.json &&
    oiq match --pricesheet prices.csv tfplan.json | oiq price
  `;

  console.log('[INFO] Running cost estimation in:', tfDir);

  exec(cmd, { shell: '/bin/bash', maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
    if (error) {
      console.error('[ERROR] OIQ estimation failed:', stderr || error);
      return res.status(500).send('Error running OpenInfraQuote.');
    }

    if (stderr) {
        console.warn('OIQ STDERR:', stderr);
    }

    // Send raw stdout as preformatted text
    res.type('text/plain').send(stdout);
  });
});

// Start Server
const PORT = process.env.PORT || 3005;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running at http://${HOST}:${PORT}`);
});
