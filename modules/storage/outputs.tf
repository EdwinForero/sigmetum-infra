output "bucket_name" {
  value = aws_s3_bucket.app.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.app.arn
}

output "cdn_url" {
  description = "CloudFront HTTPS URL for public frontend assets (use as VITE_S3_URL)"
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
}
