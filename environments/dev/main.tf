module "networking" {
  source = "../../modules/networking"
}

# Single instance — no ALB, saves ~€17/month vs prod
module "beanstalk" {
  source      = "../../modules/beanstalk"
  environment = "dev"

  vpc_id     = module.networking.vpc_id
  subnet_ids = module.networking.subnet_ids

  instance_type      = "t3.nano"
  load_balancer_type = "single"
  enable_cdn         = true
  min_instances      = 1
  max_instances      = 1

  notification_email = var.notification_email
  app_env_vars       = merge(var.app_env_vars, { COGNITO_USER_POOL_ID = module.cognito.user_pool_id })
}

module "storage" {
  source      = "../../modules/storage"
  environment = "dev"
  bucket_name = var.bucket_name
}

module "backend_ci_iam" {
  source = "../../modules/backend-ci-iam"

  environment   = "dev"
  github_repo   = "EdwinForero/sigmetum-backend"
  github_branch = "feature/testing"
  aws_region    = "eu-west-3"

  access_logs_bucket_name = module.storage.access_logs_bucket_name
}

module "cognito" {
  source      = "../../modules/cognito"
  environment = "dev"

  domain_prefix   = "sigmetum-a-dev"
  allowed_origins = module.amplify.site_origins
}

module "amplify" {
  source      = "../../modules/amplify"
  environment = "dev"

  repository          = var.github_repository
  github_access_token = var.github_access_token
  branch              = "feature/testing"
  backend_url         = module.beanstalk.backend_cdn_url
  s3_url              = module.storage.cdn_url

  cognito_domain_url = module.cognito.domain_url
  cognito_client_id  = module.cognito.client_id
}
