output "zone_id" {
  description = "ID of the Route53 hosted zone."
  value       = data.aws_route53_zone.this.zone_id
}

output "backend_fqdn" {
  description = "Fully qualified name of the backend record (backend.<zone>)."
  value       = aws_route53_record.backend.fqdn
}
