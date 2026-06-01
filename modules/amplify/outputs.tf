output "app_id" {
  value = aws_amplify_app.this.id
}

output "default_domain" {
  description = "Amplify default domain (*.amplifyapp.com)"
  value       = aws_amplify_app.this.default_domain
}

output "branch_url" {
  value = "https://${var.branch}.${aws_amplify_app.this.default_domain}"
}
