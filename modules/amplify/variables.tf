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

variable "carousel_image_keys" {
  description = "Comma-separated S3 keys for the home carousel injected as VITE_CAROUSEL_IMAGE_KEYS; empty until S3 public access (C2) is resolved"
  type        = string
  default     = ""
}
