data "aws_route53_zone" "this" {
  name         = var.zone_name
  private_zone = false
}

resource "aws_route53_record" "backend" {
  zone_id = data.aws_route53_zone.this.zone_id
  name    = "backend.${var.zone_name}"
  type    = "CNAME"
  ttl     = 300
  records = [var.backend_cname_target]
}
