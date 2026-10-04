module "networking" {
  source      = "../../modules/networking"
  environment = "prod"
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
  app_env_vars       = var.app_env_vars
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

module "amplify" {
  source      = "../../modules/amplify"
  environment = "prod"

  repository          = var.github_repository
  github_access_token = var.github_access_token
  branch              = "master"
  backend_url         = "https://backend.sigmetum-a.org"
  # s3_url left empty until C2 (S3 public access / CloudFront) is resolved
  s3_url = ""
}
