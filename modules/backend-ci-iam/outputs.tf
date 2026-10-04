output "role_arn" {
  description = "ARN of the IAM role GitHub Actions assumes to deploy to Beanstalk."
  value       = aws_iam_role.backend_ci.arn
}
