data "aws_region" "current" {}

locals {
  # Amplify replaces "/" with "-" in branch names for the subdomain
  branch_url = "https://${replace(var.branch, "/", "-")}.${aws_amplify_app.this.default_domain}"

  # Report-Only: the browser logs violations in its console and blocks nothing
  csp_report_only = join("; ", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src ${join(" ", compact(["'self'", var.s3_url, "https://*.s3.${data.aws_region.current.name}.amazonaws.com"]))}",
    "connect-src ${join(" ", compact(["'self'", var.backend_url, var.cognito_domain_url, var.cognito_domain_url == "" ? "" : "https://cognito-idp.${data.aws_region.current.name}.amazonaws.com"]))}",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ])
}

resource "aws_amplify_app" "this" {
  name         = "${var.app_name}-${var.environment}"
  repository   = var.repository
  access_token = var.github_access_token

  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - nvm install 22 && nvm use 22
            - npm ci
            - npm test
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: dist
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
  EOT

  custom_headers = <<-EOT
    customHeaders:
      - pattern: '**'
        headers:
          - key: Strict-Transport-Security
            value: "max-age=86400"
          - key: X-Content-Type-Options
            value: "nosniff"
          - key: Referrer-Policy
            value: "strict-origin-when-cross-origin"
          - key: Permissions-Policy
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
          - key: Content-Security-Policy-Report-Only
            value: "${local.csp_report_only}"
      - pattern: /index.html
        headers:
          - key: Cache-Control
            value: "no-cache"
      - pattern: /assets/*
        headers:
          - key: Cache-Control
            value: "public, max-age=31536000, immutable"
  EOT

  # VITE_COGNITO_DOMAIN and VITE_COGNITO_CLIENT_ID are set only on the branch: in dev the client id depends on the
  # branch URL (default domain), and the app must not depend on the client. The branch value takes precedence.
  environment_variables = {
    VITE_BASE_URL            = var.backend_url
    VITE_API_PREFIX          = "/api/v1"
    VITE_S3_URL              = var.s3_url
    VITE_CAROUSEL_IMAGE_KEYS = var.carousel_image_keys
  }

  # Let hashed static assets pass through
  custom_rule {
    source = "/assets/<*>"
    status = "200"
    target = "/assets/<*>"
  }
  # SPA catch-all: rewrite all other paths to index.html
  custom_rule {
    source = "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|pdf)$)([^.]+$)/>"
    status = "200"
    target = "/index.html"
  }

  tags = {
    Component = "frontend"
  }
}

resource "aws_amplify_branch" "this" {
  app_id      = aws_amplify_app.this.id
  branch_name = var.branch

  framework = "React"
  stage     = var.environment == "prod" ? "PRODUCTION" : "DEVELOPMENT"

  enable_auto_build = true

  tags = {
    Component = "frontend"
  }

  environment_variables = {
    VITE_BASE_URL             = var.backend_url
    VITE_API_PREFIX           = "/api/v1"
    VITE_S3_URL               = var.s3_url
    VITE_CAROUSEL_IMAGE_KEYS  = var.carousel_image_keys
    VITE_COGNITO_DOMAIN       = var.cognito_domain_url
    VITE_COGNITO_CLIENT_ID    = var.cognito_client_id
    VITE_COGNITO_USER_POOL_ID = var.cognito_user_pool_id
  }
}

# One association per root domain; Amplify manages the certificate (DNS validation).
# Not waiting for verification keeps apply from hanging if DNS validation is slow.
resource "aws_amplify_domain_association" "this" {
  for_each = var.custom_domains

  app_id                = aws_amplify_app.this.id
  domain_name           = each.key
  wait_for_verification = false

  dynamic "sub_domain" {
    for_each = toset(each.value)

    content {
      branch_name = aws_amplify_branch.this.branch_name
      prefix      = sub_domain.value
    }
  }
}

# The public hosted zone has the same name as the root domain and must live in this account
data "aws_route53_zone" "custom" {
  for_each = var.custom_domains

  name         = each.key
  private_zone = false
}

locals {
  # AWS-wide hosted zone id of CloudFront, required by alias records that point at a distribution
  cloudfront_hosted_zone_id = "Z2FDTNDATAQYW2"

  # Keys come only from var.custom_domains (known at plan time), never from resource attributes
  domain_records = {
    for item in flatten([
      for domain, prefixes in var.custom_domains : [
        for prefix in prefixes : {
          fqdn   = prefix == "" ? domain : "${prefix}.${domain}"
          domain = domain
          prefix = prefix
        }
      ]
    ]) : item.fqdn => item
  }

  # "<name> CNAME <value>" => [name, value]; fails at apply if Amplify returns another format
  certificate_records = {
    for domain in keys(var.custom_domains) : domain => [
      for part in split("CNAME", aws_amplify_domain_association.this[domain].certificate_verification_dns_record) :
      trimsuffix(trimspace(part), ".")
    ]
  }

  # "<prefix> CNAME <target>" (empty prefix for the apex) => target
  domain_targets = {
    for fqdn, item in local.domain_records : fqdn => trimsuffix(trimspace(split("CNAME", one([
      for sub in aws_amplify_domain_association.this[item.domain].sub_domain : sub.dns_record if sub.prefix == item.prefix
    ]))[1]), ".")
  }
}

# Certificate validation record; without it the domain never leaves PENDING_VERIFICATION
resource "aws_route53_record" "certificate_validation" {
  for_each = var.custom_domains

  zone_id = data.aws_route53_zone.custom[each.key].zone_id
  name    = local.certificate_records[each.key][0]
  type    = "CNAME"
  ttl     = 300
  records = [local.certificate_records[each.key][1]]
}

# Apex: alias to the CloudFront distribution (a CNAME is not allowed at the apex)
resource "aws_route53_record" "apex" {
  for_each = { for fqdn, item in local.domain_records : fqdn => item if item.prefix == "" }

  zone_id = data.aws_route53_zone.custom[each.value.domain].zone_id
  name    = each.key
  type    = "A"

  alias {
    name                   = local.domain_targets[each.key]
    zone_id                = local.cloudfront_hosted_zone_id
    evaluate_target_health = false
  }
}

# Subdomains (www): CNAME to the CloudFront distribution
resource "aws_route53_record" "subdomain" {
  for_each = { for fqdn, item in local.domain_records : fqdn => item if item.prefix != "" }

  zone_id = data.aws_route53_zone.custom[each.value.domain].zone_id
  name    = each.key
  type    = "CNAME"
  ttl     = 300
  records = [local.domain_targets[each.key]]
}
