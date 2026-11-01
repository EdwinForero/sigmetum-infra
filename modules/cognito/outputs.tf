output "user_pool_id" {
  description = "ID of the Cognito user pool; the region is its prefix."
  value       = aws_cognito_user_pool.this.id
}

output "client_id" {
  description = "ID of the public app client (no client secret)."
  value       = aws_cognito_user_pool_client.this.id
}

output "domain_url" {
  description = "Base URL of the Cognito hosted UI (https, no trailing slash)."
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.name}.amazoncognito.com"
}

output "region" {
  description = "AWS region of the user pool."
  value       = data.aws_region.current.name
}

output "callback_urls" {
  description = "Sign-in callback URLs registered in the app client."
  value       = local.callback_urls
}

output "logout_urls" {
  description = "Sign-out URLs registered in the app client."
  value       = local.logout_urls
}
