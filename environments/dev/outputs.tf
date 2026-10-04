output "beanstalk_url" {
  value = module.beanstalk.endpoint_url
}

output "backend_cdn_url" {
  value = module.beanstalk.backend_cdn_url
}

output "amplify_url" {
  value = module.amplify.branch_url
}

output "s3_bucket" {
  value = module.storage.bucket_name
}

output "cdn_url" {
  value = module.storage.cdn_url
}
