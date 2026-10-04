output "beanstalk_url" {
  value = module.beanstalk.endpoint_url
}

output "backend_fqdn" {
  value = module.dns.backend_fqdn
}

output "amplify_url" {
  value = module.amplify.branch_url
}

output "s3_bucket" {
  value = module.storage.bucket_name
}

output "ci_role_arn" {
  description = "ARN of the IAM role for GitHub Actions CI. Set as AWS_ROLE_PROD in GitHub Actions variables."
  value       = module.backend_ci_iam.role_arn
}

