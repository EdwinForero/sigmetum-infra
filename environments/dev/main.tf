module "networking" {
  source      = "../../modules/networking"
  environment = "dev"
}

# Single instance — no ALB, saves ~€17/month vs prod
module "beanstalk" {
  source      = "../../modules/beanstalk"
  environment = "dev"

  vpc_id     = module.networking.vpc_id
  subnet_ids = module.networking.subnet_ids

  instance_type      = "t3.nano"
  load_balancer_type = "single"
  min_instances      = 1
  max_instances      = 1

  notification_email = var.notification_email
  app_env_vars       = var.app_env_vars
}

module "storage" {
  source      = "../../modules/storage"
  environment = "dev"
  bucket_name = var.bucket_name
}

module "amplify" {
  source      = "../../modules/amplify"
  environment = "dev"

  repository          = var.github_repository
  github_access_token = var.github_access_token
  branch              = "feature/testing"
  backend_url         = "http://${module.beanstalk.endpoint_url}"
  s3_url              = module.storage.cdn_url
}
