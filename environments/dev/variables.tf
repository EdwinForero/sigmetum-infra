variable "account_id" {
  description = "AWS account ID for this environment."
  type        = string
}

variable "notification_email" {
  type = string
}

variable "bucket_name" {
  type = string
}

variable "ssl_certificate_arn" {
  type    = string
  default = ""
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
