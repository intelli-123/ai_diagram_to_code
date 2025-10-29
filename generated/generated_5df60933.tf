```terraform
provider "aws" {
  region = "us-east-1"
}

# Helper data source for AWS partition
data "aws_partition" "current" {}

# ------------------------------------------------------------
# 1. Lambda Source Code
#    These local_file resources create the Python scripts
#    which are then archived for Lambda deployment.
# ------------------------------------------------------------

resource "local_file" "get_product_lambda_py" {
  content  = <<EOT
import json

def handler(event, context):
    print("Get Product Lambda invoked")
    # In a real scenario, this would interact with DynamoDB
    return {
        'statusCode': 200,
        'body': json.dumps('Product retrieved!')
    }
EOT
  filename = "${path.module}/get_product_lambda.py"
}

resource "local_file" "add_product_lambda_py" {
  content  = <<EOT
import json

def handler(event, context):
    print("Add Product Lambda invoked")
    # In a real scenario, this would interact with DynamoDB
    return {
        'statusCode': 200,
        'body': json.dumps('Product added!')
    }
EOT
  filename = "${path.module}/add_product_lambda.py"
}

resource "local_file" "health_check_lambda_py" {
  content  = <<EOT
import json

def handler(event, context):
    print("Health Check Lambda invoked")
    return {
        'statusCode': 200,
        'body': json.dumps('API is healthy!')
    }
EOT
  filename = "${path.module}/health_check_lambda.py"
}

resource "local_file" "replication_lambda_py" {
  content  = <<EOT
import json

def handler(event, context):
    print("Replication Lambda invoked")
    for record in event['Records']:
        print(f"Processing DynamoDB Stream record: {json.dumps(record)}")
        # In a real scenario, this would send data to an external system
    return {
        'statusCode': 200,
        'body': json.dumps('Replication processed!')
    }
EOT
  filename = "${path.module}/replication_lambda.py"
}

# Archive the Lambda source code
data "archive_file" "get_product_lambda_zip" {
  type        = "zip"
  source_file = local_file.get_product_lambda_py.filename
  output_path = "${path.module}/get_product_lambda.zip"
}

data "archive_file" "add_product_lambda_zip" {
  type        = "zip"
  source_file = local_file.add_product_lambda_py.filename
  output_path = "${path.module}/add_product_lambda.zip"
}

data "archive_file" "health_check_lambda_zip" {
  type        = "zip"
  source_file = local_file.health_check_lambda_py.filename
  output_path = "${path.module}/health_check_lambda.zip"
}

data "archive_file" "replication_lambda_zip" {
  type        = "zip"
  source_file = local_file.replication_lambda_py.filename
  output_path = "${path.module}/replication_lambda.zip"
}

# ------------------------------------------------------------
# 2. DynamoDB Table
# ------------------------------------------------------------

resource "aws_dynamodb_table" "product_db" {
  name             = "ProductDB"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "id"
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  attribute {
    name = "id"
    type = "S"
  }

  tags = {
    Name = "ProductDB"
  }
}

# ------------------------------------------------------------
# 3. IAM Roles for Lambda Functions
# ------------------------------------------------------------

resource "aws_iam_role" "get_product_lambda_role" {
  name = "get_product_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "get_product_lambda_logs" {
  role       = aws_iam_role.get_product_lambda_role.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "get_product_lambda_dynamodb_policy" {
  name = "get_product_lambda_dynamodb_policy"
  role = aws_iam_role.get_product_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ]
        Resource = [
          aws_dynamodb_table.product_db.arn,
          "${aws_dynamodb_table.product_db.arn}/*", # Include for potential secondary indexes
        ]
      },
    ]
  })
}

resource "aws_iam_role" "add_product_lambda_role" {
  name = "add_product_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "add_product_lambda_logs" {
  role       = aws_iam_role.add_product_lambda_role.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "add_product_lambda_dynamodb_policy" {
  name = "add_product_lambda_dynamodb_policy"
  role = aws_iam_role.add_product_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
        ]
        Resource = [
          aws_dynamodb_table.product_db.arn,
          "${aws_dynamodb_table.product_db.arn}/*", # Include for potential secondary indexes
        ]
      },
    ]
  })
}

resource "aws_iam_role" "health_check_lambda_role" {
  name = "health_check_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "health_check_lambda_logs" {
  role       = aws_iam_role.health_check_lambda_role.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role" "replication_lambda_role" {
  name = "replication_lambda_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      },
    ]
  })
}

resource "aws_iam_role_policy_attachment" "replication_lambda_logs" {
  role       = aws_iam_role.replication_lambda_role.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "replication_lambda_dynamodb_stream_policy" {
  name = "replication_lambda_dynamodb_stream_policy"
  role = aws_iam_role.replication_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams",
        ]
        Resource = aws_dynamodb_table.product_db.stream_arn
      },
    ]
  })
}

# ------------------------------------------------------------
# 4. Lambda Functions
# ------------------------------------------------------------

resource "aws_lambda_function" "get_product_lambda" {
  function_name    = "GetProductLambda"
  handler          = "get_product_lambda.handler"
  runtime          = "python3.9"
  role             = aws_iam_role.get_product_lambda_role.arn
  filename         = data.archive_file.get_product_lambda_zip.output_path
  source_code_hash = data.archive_file.get_product_lambda_zip.output_base64sha256
  timeout          = 30

  depends_on = [
    aws_iam_role_policy_attachment.get_product_lambda_logs,
    aws_iam_role_policy.get_product_lambda_dynamodb_policy,
  ]
}

resource "aws_lambda_function" "add_product_lambda" {
  function_name    = "AddProductLambda"
  handler          = "add_product_lambda.handler"
  runtime          = "python3.9"
  role             = aws_iam_role.add_product_lambda_role.arn
  filename         = data.archive_file.add_product_lambda_zip.output_path
  source_code_hash = data.archive_file.add_product_lambda_zip.output_base64sha256
  timeout          = 30

  depends_on = [
    aws_iam_role_policy_attachment.add_product_lambda_logs,
    aws_iam_role_policy.add_product_lambda_dynamodb_policy,
  ]
}

resource "aws_lambda_function" "health_check_lambda" {
  function_name    = "HealthCheckLambda"
  handler          = "health_check_lambda.handler"
  runtime          = "python3.9"
  role             = aws_iam_role.health_check_lambda_role.arn
  filename         = data.archive_file.health_check_lambda_zip.output_path
  source_code_hash = data.archive_file.health_check_lambda_zip.output_base64sha256
  timeout          = 30

  depends_on = [
    aws_iam_role_policy_attachment.health_check_lambda_logs,
  ]
}

resource "aws_lambda_function" "replication_lambda" {
  function_name    = "ReplicationLambda"
  handler          = "replication_lambda.handler"
  runtime          = "python3.9"
  role             = aws_iam_role.replication_lambda_role.arn
  filename         = data.archive_file.replication_lambda_zip.output_path
  source_code_hash = data.archive_file.replication_lambda_zip.output_base64sha256
  timeout          = 30

  depends_on = [
    aws_iam_role_policy_attachment.replication_lambda_logs,
    aws_iam_role_policy.replication_lambda_dynamodb_stream_policy,
  ]
}

# ------------------------------------------------------------
# 5. API Gateway
# ------------------------------------------------------------

resource "aws_api_gateway_rest_api" "main_api" {
  name        = "ProductAPI"
  description = "API Gateway for Product services"
}

resource "aws_api_gateway_resource" "products_resource" {
  rest_api_id = aws_api_gateway_rest_api.main_api.id
  parent_id   = aws_api_gateway_rest_api.main_api.root_resource_id
  path_part   = "products"
}

resource "aws_api_gateway_method" "get_products_method" {
  rest_api_id   = aws_api_gateway_rest_api.main_api.id
  resource_id   = aws_api_gateway_resource.products_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_products_integration" {
  rest_api_id             = aws_api_gateway_rest_api.main_api.id
  resource_id             = aws_api_gateway_resource.products_resource.id
  http_method             = aws_api_gateway_method.get_products_method.http_method
  integration_http_method = "POST" # Lambda invocations are always POST
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.get_product_lambda.invoke_arn
}

resource "aws_api_gateway_method" "add_products_method" {
  rest_api_id   = aws_api_gateway_rest_api.main_api.id
  resource_id   = aws_api_gateway_resource.products_resource.id
  http_method   = "POST"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "add_products_integration" {
  rest_api_id             = aws_api_gateway_rest_api.main_api.id
  resource_id             = aws_api_gateway_resource.products_resource.id
  http_method             = aws_api_gateway_method.add_products_method.http_method
  integration_http_method = "POST" # Lambda invocations are always POST
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.add_product_lambda.invoke_arn
}

resource "aws_api_gateway_resource" "health_resource" {
  rest_api_id = aws_api_gateway_rest_api.main_api.id
  parent_id   = aws_api_gateway_rest_api.main_api.root_resource_id
  path_part   = "health"
}

resource "aws_api_gateway_method" "get_health_method" {
  rest_api_id   = aws_api_gateway_rest_api.main_api.id
  resource_id   = aws_api_gateway_resource.health_resource.id
  http_method   = "GET"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "get_health_integration" {
  rest_api_id             = aws_api_gateway_rest_api.main_api.id
  resource_id             = aws_api_gateway_resource.health_resource.id
  http_method             = aws_api_gateway_method.get_health_method.http_method
  integration_http_method = "POST" # Lambda invocations are always POST
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.health_check_lambda.invoke_arn
}

resource "aws_api_gateway_deployment" "main_api_deployment" {
  rest_api_id = aws_api_gateway_rest_api.main_api.id
  
  # Force a new deployment on API changes
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.products_resource.id,
      aws_api_gateway_method.get_products_method.id,
      aws_api_gateway_integration.get_products_integration.id,
      aws_api_gateway_method.add_products_method.id,
      aws_api_gateway_integration.add_products_integration.id,
      aws_api_gateway_resource.health_resource.id,
      aws_api_gateway_method.get_health_method.id,
      aws_api_gateway_integration.get_health_integration.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.get_products_integration,
    aws_api_gateway_integration.add_products_integration,
    aws_api_gateway_integration.get_health_integration,
  ]
}

resource "aws_api_gateway_stage" "dev_stage" {
  deployment_id = aws_api_gateway_deployment.main_api_deployment.id
  rest_api_id   = aws_api_gateway_rest_api.main_api.id
  stage_name    = "dev"
}

# ------------------------------------------------------------
# 6. Lambda Permissions for API Gateway
# ------------------------------------------------------------

resource "aws_lambda_permission" "allow_api_gateway_invoke_get_product" {
  statement_id  = "AllowAPIGatewayInvokeGetProduct"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_product_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_api_gateway_invoke_add_product" {
  statement_id  = "AllowAPIGatewayInvokeAddProduct"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.add_product_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_api_gateway_invoke_health_check" {
  statement_id  = "AllowAPIGatewayInvokeHealthCheck"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.health_check_lambda.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.main_api.execution_arn}/*/*"
}

# ------------------------------------------------------------
# 7. DynamoDB Stream and Lambda Event Source Mapping
# ------------------------------------------------------------

resource "aws_lambda_event_source_mapping" "replication_lambda_dynamodb_stream_mapping" {
  event_source_arn  = aws_dynamodb_table.product_db.stream_arn
  function_name     = aws_lambda_function.replication_lambda.arn
  starting_position = "LATEST"
  batch_size        = 100
  enabled           = true

  depends_on = [
    aws_iam_role_policy.replication_lambda_dynamodb_stream_policy # Ensure policy is attached first
  ]
}

# ------------------------------------------------------------
# 8. Outputs
# ------------------------------------------------------------

output "api_gateway_base_url" {
  description = "The base URL for the API Gateway."
  value       = "${aws_api_gateway_deployment.main_api_deployment.invoke_url}/${aws_api_gateway_stage.dev_stage.stage_name}"
}

output "product_db_table_name" {
  description = "Name of the DynamoDB table."
  value       = aws_dynamodb_table.product_db.name
}
```