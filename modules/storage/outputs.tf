output "bucket_name" {
  description = "Name of the data and assets S3 bucket."
  value       = aws_s3_bucket.app.bucket
}

output "bucket_arn" {
  description = "ARN of the data and assets S3 bucket."
  value       = aws_s3_bucket.app.arn
}

output "cdn_url" {
  description = "CloudFront HTTPS URL for public frontend assets (use as VITE_S3_URL)"
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}
