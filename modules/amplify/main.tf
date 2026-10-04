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
    VITE_BASE_URL            = var.backend_url
    VITE_API_PREFIX          = "/api/v1"
    VITE_S3_URL              = var.s3_url
    VITE_CAROUSEL_IMAGE_KEYS = var.carousel_image_keys
    NODE_ENV                 = var.environment
  }

  # Let hashed static assets pass through
  custom_rule {
    source = "/assets/<*>"
    status = "200"
    target = "/assets/<*>"
  }
  # SPA catch-all: rewrite all other paths to index.html
  custom_rule {
    source = "</^((?!\\.).)+$>"
    status = "200"
    target = "/index.html"
  }

  tags = {
    Component = "frontend"
  }
}

resource "aws_amplify_branch" "this" {
  app_id      = aws_amplify_app.this.id
  branch_name = var.branch

  framework = "React"
  stage     = var.environment == "prod" ? "PRODUCTION" : "DEVELOPMENT"

  enable_auto_build = true

  environment_variables = {
    VITE_BASE_URL            = var.backend_url
    VITE_API_PREFIX          = "/api/v1"
    VITE_S3_URL              = var.s3_url
    VITE_CAROUSEL_IMAGE_KEYS = var.carousel_image_keys
  }
}
