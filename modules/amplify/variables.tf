variable "environment" {
  type = string
}

variable "app_name" {
  type    = string
  default = "sigmetum-frontend"
}

variable "repository" {
  description = "GitHub repository URL (e.g. https://github.com/org/sigmetum-frontend)"
  type        = string
}

variable "github_access_token" {
  description = "GitHub personal access token with repo scope"
  type        = string
  sensitive   = true
}

variable "branch" {
  description = "Git branch to deploy"
  type        = string
  default     = "master"
}

variable "backend_url" {
  description = "Backend base URL injected as VITE_BASE_URL"
  type        = string
}

variable "s3_url" {
  description = "Public S3 (or CloudFront) base URL injected as VITE_S3_URL"
  type        = string
  default     = ""
}
