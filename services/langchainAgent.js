const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initializeAgentExecutorWithOptions } = require('langchain/agents');
const { DynamicTool } = require('langchain/tools');

require('dotenv').config();

async function editTerraformCode(originalCode, userInstruction) {
  const model = new GoogleGenerativeAI({ temperature: 0, apiKey: process.env.GEMINI_API_KEY});
  //const model = new ChatOpenAI({ temperature: 0, apiKey: process.env.OPENAI_API_KEY });

  const editTool = new DynamicTool({
    name: 'terraform_editor',
    description: 'Edits Terraform code based on user instructions',
    func: async (input) => {
      return `Edit the following Terraform code:\n${originalCode}\n\nInstruction:\n${input}`;
    },
  });

  const executor = await initializeAgentExecutorWithOptions([editTool], model, {
    agentType: 'chat-conversational-react-description',
    verbose: true,
  });

  const result = await executor.call({ input: userInstruction });
  return result.output;
}

module.exports = { editTerraformCode };