output "beanstalk_url" {
  value = module.beanstalk.endpoint_url
}

output "amplify_url" {
  value = module.amplify.branch_url
}

output "s3_bucket" {
  value = module.storage.bucket_name
}
