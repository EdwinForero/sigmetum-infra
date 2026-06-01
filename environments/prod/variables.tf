variable "notification_email" {
  type = string
}

variable "bucket_name" {
  type = string
}

variable "ssl_certificate_arn" {
  description = "ACM certificate ARN for HTTPS. Get it from AWS Certificate Manager."
  type        = string
}

variable "github_access_token" {
  type      = string
  sensitive = true
}

variable "github_repository" {
  type = string
}

variable "app_env_vars" {
  type      = map(string)
  sensitive = true
  default   = {}
}
