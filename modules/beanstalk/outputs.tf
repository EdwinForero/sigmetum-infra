output "endpoint_url" {
  description = "EB environment CNAME (use this in Route53)"
  value       = aws_elastic_beanstalk_environment.this.cname
}

output "environment_name" {
  value = aws_elastic_beanstalk_environment.this.name
}

output "application_name" {
  value = aws_elastic_beanstalk_application.this.name
}

output "load_balancers" {
  description = "List of load balancer hostnames attached to the environment"
  value       = aws_elastic_beanstalk_environment.this.load_balancers
}

output "backend_cdn_url" {
  description = "CloudFront HTTPS URL for the backend (dev only; empty when enable_cdn = false)"
  value       = length(aws_cloudfront_distribution.backend) > 0 ? "https://${aws_cloudfront_distribution.backend[0].domain_name}" : ""
}
