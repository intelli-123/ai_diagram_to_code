
# AI Diagram to Terraform Generator

[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.x-blue?logo=express)](https://expressjs.com/)
[![Google Gemini API](https://img.shields.io/badge/Google_Gemini-API-orange?logo=google&logoColor=white)](https://ai.google.dev/models/gemini)
[![Terraform](https://img.shields.io/badge/Terraform-CLI-7B42BC?logo=terraform)](https://www.terraform.io/)
[![TFLint](https://img.shields.io/badge/TFLint-CLI-blueviolet)](https://github.com/terraform-linters/tflint)
[![OpenInfraQuote](https://img.shields.io/badge/OpenInfraQuote-Cost_Estimation-D97100?logo=terraform)](https://www.terrateam.io/openinfraquote)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🌟 Overview

The **AI Diagram to Terraform Generator** is a web application that revolutionizes infrastructure provisioning by converting architectural diagrams directly into cloud-agnostic Terraform code. Leveraging Google Gemini AI, it intelligently parses your visual blueprints, detects the target cloud provider, generates valid HCL code, and provides an interactive chat interface for further modifications, linting, and even cost estimation.

This tool aims to bridge the gap between architectural design and implementation, accelerating the development lifecycle for cloud engineers and DevOps teams.

## ✨ Features

*   **Intelligent Diagram Parsing:** Upload your cloud architecture diagrams, and the AI will identify components and their connections.
*   **Automatic Cloud Provider Detection:** Gemini AI attempts to automatically detect the cloud provider (AWS, Azure, or GCP) from your diagram. If unsure, it will intelligently prompt you to specify.
*   **Multi-Cloud Terraform Generation:** Generates valid Terraform HCL for AWS, Azure, or Google Cloud Platform, based on the detected or specified provider.
*   **Interactive Chat Interface:** A real-time chat window allows you to:
    *   **Modify Code:** Send natural language instructions to Gemini to modify the generated Terraform code.
    *   **Lint Code:** Run `terraform validate` and `tflint` to check for syntax errors and best practices.
    *   **Estimate Cost:** Utilize `OpenInfraQuote` to get an estimated cost of the generated infrastructure.
*   **Live Code Display & Download:** View the generated and updated Terraform code directly in the UI, with a convenient button to download the latest version.
*   **Robust Backend Operations:** Handles temporary file creation, cleanup, and execution of Terraform CLI tools.
*   **Responsive UI:** A user-friendly interface that adapts to various screen sizes.

## ⚙️ How It Works

1.  **Diagram Upload:** The user uploads an architectural diagram (e.g., PNG, JPEG) through the web interface.
2.  **AI Parsing & Cloud Detection:**
    *   The backend (Node.js) sends the image to the **Google Gemini API**.
    *   Gemini analyzes the image, extracts cloud components (e.g., EC2, Lambda, S3 for AWS; Azure Function App, Storage Account; GCP Cloud Function, Cloud Storage).
    *   **Crucially, Gemini attempts to identify the cloud provider.**
    *   If the cloud provider is ambiguous, the application prompts the user for manual selection.
3.  **Terraform Generation:**
    *   Based on the parsed components and the (detected or specified) cloud provider, Gemini generates the initial Terraform HCL code.
    *   The backend performs a post-generation cleanup to ensure the Terraform code is immediately valid for `terraform validate` and `tflint` by replacing local file dependencies for serverless functions (like Lambda/Cloud Functions) with inline code or dummy remote references.
4.  **Interactive Workflow:**
    *   The generated Terraform code is displayed in a chat-like interface.
    *   The user can then type commands into the chat:
        *   **Modification:** Commands like "Change instance type to t3.medium" are sent to Gemini (via `geminiEditorAgent.js`) to directly modify the `lastGeneratedCode` variable.
        *   **Linting:** Commands like "Run linting" trigger `terraform init`, `terraform validate`, and `tflint` in a temporary directory containing the generated `.tf` file.
        *   **Cost Estimation:** Commands like "Estimate cost" trigger `terraform init`, `terraform plan`, `terraform show -json`, and `oiq` in the temporary directory.
5.  **Feedback Loop:** The results of any command (updated code, linting output, cost estimations) are displayed back to the user in the chat interface.

## ☁️ Supported Cloud Providers

*   **Amazon Web Services (AWS)**
*   **Microsoft Azure**
*   **Google Cloud Platform (GCP)**

## 🚀 Getting Started

### Prerequisites

Before running this application, you'll need:

*   **Node.js (LTS version recommended):** [Download Node.js](https://nodejs.org/)
*   **npm** (comes with Node.js)
*   **Google Cloud Project with Gemini API enabled:**
    *   Create a Google Cloud Project if you don't have one.
    *   Enable the "Gemini API" or "Generative Language API" in your Google Cloud Console.
    *   Generate an API Key for the Gemini API.
*   **Terraform CLI:** [Install Terraform](https://www.terraform.io/downloads) (Ensure it's in your system's PATH).
*   **TFLint CLI:** [Install TFLint](https://terraform-linters.github.io/tflint/latest/installation/) (Ensure it's in your system's PATH).
*   **OpenInfraQuote CLI (oiq):** [Install OpenInfraQuote](https://www.terrateam.io/openinfraquote/docs/installation) (Ensure it's in your system's PATH).
*   **`curl` and `gunzip`:** These are usually pre-installed on Linux and macOS. For Windows, you might need Git Bash or WSL.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/intelli-123/ai_diagram_to_code.git
    cd ai_diagram_to_code
    ```

2.  **Install Node.js dependencies:**
    ```bash
    npm install
    ```

3.  **Configure environment variables:**
    Create a `.env` file in the root directory of the project and add your Google Gemini API Key:
    ```
    GEMINI_API_KEY=YOUR_GEMINI_API_KEY_HERE
    PORT=3005
    HOST=0.0.0.0
    ```
    *Replace `YOUR_GEMINI_API_KEY_HERE` with your actual Gemini API key.*

### Running the Application

1.  **Start the backend server:**
    ```bash
    npm start
    # or
    node server.js
    ```
    You should see a message like: `🚀 Server running at http://0.0.0.0:3005`

2.  **Open the application in your browser:**
    Navigate to `http://localhost:3005` (or the PORT you configured) in your web browser.

## 👨‍💻 Usage

1.  **Upload Diagram:**
    *   On the initial screen, click "Choose File" to select your architectural diagram (PNG, JPEG recommended).
    *   Click "Generate Terraform".
    *   The UI will switch to a chat interface. You'll see your uploaded diagram and a bot message indicating processing.
    *   If Gemini cannot confidently detect the cloud provider from the diagram, it will display an error message prompting you to specify it. In this case, re-upload the diagram and use a query parameter:
        *   `POST /upload?cloudProvider=aws`
        *   `POST /upload?cloudProvider=azure`
        *   `POST /upload?cloudProvider=gcp`
        (This will require programmatic interaction if your UI doesn't expose a dropdown, or a manual refresh with the query parameter if the UI is still expecting an initial upload).

2.  **View Generated Code:**
    *   Once processing is complete, the generated Terraform code will appear in a new bot message.
    *   Use the "Download" button to save the `generated.tf` file.

3.  **Interact via Chat:**
    Type your commands or questions into the input box at the bottom of the chat and click "Send" (or press Enter):

    *   **Modify Code:**
        *   `Change the S3 bucket name to my-unique-application-logs`
        *   `Add a security group to the EC2 instance allowing port 80`
        *   `Make the Lambda runtime nodejs20.x`
        *   `Change the GCP Cloud Function region to europe-west1`

    *   **Lint Code:**
        *   `Run linting`
        *   `Validate the Terraform code`

    *   **Estimate Cost:**
        *   `Estimate the cost`
        *   `What's the estimated monthly cost?`

    The bot will respond with the updated code, linting results, or cost estimations.

##
## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
