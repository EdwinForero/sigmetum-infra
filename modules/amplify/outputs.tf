output "app_id" {
  description = "ID of the Amplify app."
  value       = aws_amplify_app.this.id
}

output "default_domain" {
  description = "Amplify default domain (*.amplifyapp.com)"
  value       = aws_amplify_app.this.default_domain
}

output "branch_url" {
  description = "URL of the deployed branch on the Amplify default domain; slashes in the branch name become dashes."
  # Amplify replaces "/" with "-" in branch names for the subdomain
  value = "https://${replace(var.branch, "/", "-")}.${aws_amplify_app.this.default_domain}"
}
