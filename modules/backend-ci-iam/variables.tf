variable "environment" {
  description = "Deployment environment: dev or prod."
  type        = string
}

variable "github_repo" {
  description = "GitHub repo in owner/name format, e.g. edwinmenfor2000/sigmetum-backend"
  type        = string
}

variable "github_branch" {
  description = "Branch that is allowed to assume the CI role, e.g. feature/testing"
  type        = string
}

variable "aws_region" {
  description = "AWS region where Beanstalk resources live, e.g. eu-west-3."
  type        = string
}
