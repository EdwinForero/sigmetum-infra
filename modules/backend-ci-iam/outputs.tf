output "role_arn" {
  description = "ARN of the IAM role GitHub Actions assumes to deploy to Beanstalk."
  value       = aws_iam_role.backend_ci.arn
}

output "bucket_name" {
  description = "Name of the S3 bucket used to store deployment artifacts."
  value       = aws_s3_bucket.deploys.bucket
}
