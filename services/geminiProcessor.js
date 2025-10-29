const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function processImageWithGemini(imagePath) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const imageBytes = fs.readFileSync(imagePath);
  const mimeType = 'image/png'; // You can enhance this to detect dynamically

  const prompt = `
You are a cloud architecture parser. Your task is to extract structured cloud components and their connectivity **only** from valid IT architecture diagrams.

If the image is not a cloud or IT architecture diagram (e.g., a photo, unrelated chart, or random drawing), respond with:
{
  "error": "Invalid diagram. Only IT/cloud architecture diagrams are supported."
}

Otherwise, return a structured JSON object with two keys:
1. "components": a list of cloud components with type, name, and properties.
2. "connections": a list of directional links showing how components are connected.

For connections:
- Use directional links to represent flow or dependency (e.g., traffic from client to EC2).
- Infer connections from spatial layout, arrows, and component properties (e.g., "located_in_subnet" implies a connection to that subnet).
- Include indirect connections if clearly implied (e.g., EC2 in public subnet connected to Internet Gateway via subnet).
- Avoid duplicate or circular connections unless explicitly shown.

Use this format:
{
  "components": [
    {
      "type": "string",
      "name": "string",
      "properties": { "key": "value" }
    }
  ],
  "connections": [
    {
      "from": "component name",
      "to": "component name"
    }
  ]
}

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
  return response.text(); // This should now be a JSON string
}

module.exports = { processImageWithGemini };






// const fs = require('fs');
// const { GoogleGenerativeAI } = require('@google/generative-ai');
// require('dotenv').config();

// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// async function processImageWithGemini(imagePath) {
//   const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

//   const imageBytes = fs.readFileSync(imagePath);
//   const mimeType = 'image/png'; // You can enhance this to detect dynamically

//   const result = await model.generateContent([
//     { text: 'Extract cloud architecture components from this diagram.' },
//     {
//       inlineData: {
//         mimeType,
//         data: imageBytes.toString('base64'),
//       },
//     },
//   ]);

//   const response = await result.response;
//   return response.text();
// }

// module.exports = { processImageWithGemini };
