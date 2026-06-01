output "zone_id" {
  value = data.aws_route53_zone.this.zone_id
}

output "backend_fqdn" {
  value = aws_route53_record.backend.fqdn
}
