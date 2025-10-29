// services/geminiEditorAgent.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function editTerraformCode(originalCode, userInstruction) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const prompt = `
You are a Terraform code editor. Your task is to modify the given Terraform code based on user instructions.

Instructions:
${userInstruction}

Terraform Code:
\`\`\`hcl
${originalCode}
\`\`\`

Return only the updated Terraform code. Do not include explanations or markdown.
`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text().replace(/```hcl|```/g, '').trim();
}

module.exports = { editTerraformCode };
``