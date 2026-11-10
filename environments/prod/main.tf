module "networking" {
  source = "../../modules/networking"
}

# ALB + Auto Scaling 1→3, HTTPS, Rolling deployment
module "beanstalk" {
  source      = "../../modules/beanstalk"
  environment = "prod"

  vpc_id     = module.networking.vpc_id
  subnet_ids = module.networking.subnet_ids

  instance_type      = "t3.nano"
  load_balancer_type = "application"
  min_instances      = 1
  max_instances      = 3

  ssl_certificate_arn = var.ssl_certificate_arn

  notification_email = var.notification_email
  app_env_vars       = merge(var.app_env_vars, { COGNITO_USER_POOL_ID = module.cognito.user_pool_id })
}

module "storage" {
  source      = "../../modules/storage"
  environment = "prod"
  bucket_name = var.bucket_name
}

module "dns" {
  source    = "../../modules/dns"
  zone_name = "sigmetum-a.org"

  # EB exposes a CNAME; if ALB is active, use load_balancers[0] for Alias record
  backend_cname_target = module.beanstalk.endpoint_url
}

module "backend_ci_iam" {
  source = "../../modules/backend-ci-iam"

  environment   = "prod"
  github_repo   = "EdwinForero/sigmetum-backend"
  github_branch = "master"
  aws_region    = "eu-west-3"

  access_logs_bucket_name = module.storage.access_logs_bucket_name
}

module "cognito" {
  source      = "../../modules/cognito"
  environment = "prod"

  domain_prefix   = "sigmetum-a-prod"
  allowed_origins = module.amplify.site_origins
}

module "amplify" {
  source      = "../../modules/amplify"
  environment = "prod"

  repository          = var.github_repository
  github_access_token = var.github_access_token
  branch              = "master"
  backend_url         = "https://backend.sigmetum-a.org"
  s3_url              = module.storage.cdn_url

  cognito_domain_url = module.cognito.domain_url
  cognito_client_id  = module.cognito.client_id

  cognito_user_pool_id = module.cognito.user_pool_id

  # Apex and www serve the same app from master; both must be in ALLOWED_ORIGIN (deploy the backend first)
  custom_domains = {
    "sigmetum-a.org" = ["", "www"]
  }
}
