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
  value       = local.branch_url
}

output "site_origins" {
  description = "Origins (https://host, no trailing slash) from which the frontend is served: the custom domains if any, otherwise the default-domain branch URL."
  value       = length(var.custom_domains) > 0 ? [for fqdn in sort(keys(local.domain_records)) : "https://${fqdn}"] : [local.branch_url]
}
