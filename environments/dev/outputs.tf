output "beanstalk_url" {
  description = "Beanstalk environment endpoint (CNAME, no scheme)."
  value       = module.beanstalk.endpoint_url
}

output "backend_cdn_url" {
  description = "CloudFront HTTPS URL of the backend (dev only), used as the frontend backend_url."
  value       = module.beanstalk.backend_cdn_url
}

output "amplify_url" {
  description = "URL of the deployed Amplify branch."
  value       = module.amplify.branch_url
}

output "s3_bucket" {
  description = "Name of the S3 bucket."
  value       = module.storage.bucket_name
}

output "cdn_url" {
  description = "CloudFront HTTPS URL for the public frontend assets."
  value       = module.storage.cdn_url
}

output "ci_role_arn" {
  description = "ARN of the IAM role for GitHub Actions CI. Set as AWS_ROLE_DEV in GitHub Actions variables."
  value       = module.backend_ci_iam.role_arn
}

