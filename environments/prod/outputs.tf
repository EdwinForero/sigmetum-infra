output "beanstalk_url" {
  description = "Beanstalk environment endpoint (CNAME, no scheme)."
  value       = module.beanstalk.endpoint_url
}

output "backend_fqdn" {
  description = "Route53 domain name of the backend."
  value       = module.dns.backend_fqdn
}

output "amplify_url" {
  description = "URL of the deployed Amplify branch."
  value       = module.amplify.branch_url
}

output "s3_bucket" {
  description = "Name of the S3 bucket."
  value       = module.storage.bucket_name
}

output "ci_role_arn" {
  description = "ARN of the IAM role for GitHub Actions CI. Set as AWS_ROLE_PROD in GitHub Actions variables."
  value       = module.backend_ci_iam.role_arn
}

