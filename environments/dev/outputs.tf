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

output "ci_role_arn" {
  description = "ARN of the IAM role for GitHub Actions CI. Set as AWS_ROLE_DEV in GitHub Actions variables."
  value       = module.backend_ci_iam.role_arn
}

output "ci_bucket_name" {
  description = "S3 bucket for deployment artifacts."
  value       = module.backend_ci_iam.bucket_name
}
