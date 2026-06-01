resource "aws_amplify_app" "this" {
  name         = "${var.app_name}-${var.environment}"
  repository   = var.repository
  access_token = var.github_access_token

  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: dist
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
  EOT

  environment_variables = {
    VITE_API_URL = var.backend_url
    NODE_ENV     = var.environment
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_amplify_branch" "this" {
  app_id      = aws_amplify_app.this.id
  branch_name = var.branch

  framework = "React"
  stage     = var.environment == "prod" ? "PRODUCTION" : "DEVELOPMENT"

  enable_auto_build = true

  environment_variables = {
    VITE_API_URL = var.backend_url
  }
}
