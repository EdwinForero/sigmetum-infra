variable "notification_email" {
  description = "Email address that receives the Beanstalk SNS notifications (health, deploy)."
  type        = string
}

variable "bucket_name" {
  description = "Globally unique name of the S3 bucket for app data and assets."
  type        = string
}

variable "github_access_token" {
  description = "GitHub personal access token that Amplify uses to read the frontend repository."
  type        = string
  sensitive   = true
}

variable "github_repository" {
  description = "URL of the frontend GitHub repository that Amplify builds."
  type        = string
}

variable "app_env_vars" {
  description = "Application environment variables for the backend process, passed to the beanstalk module. Sensitive; the keys are listed in docs/referencia-modulos.md."
  type        = map(string)
  sensitive   = true
  default     = {}
}
