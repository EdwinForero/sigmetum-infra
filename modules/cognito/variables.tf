variable "environment" {
  description = "Deployment environment: dev or prod. Forms the user pool name; deletion protection is active only in prod."
  type        = string
}

variable "app_name" {
  description = "Prefix of the user pool name; the pool is named <app_name>-<environment>."
  type        = string
  default     = "sigmetum"
}

variable "domain_prefix" {
  description = "Prefix of the Cognito hosted UI domain (<prefix>.auth.<region>.amazoncognito.com). Unique per region."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", var.domain_prefix)) && !can(regex("aws|amazon|cognito", var.domain_prefix))
    error_message = "domain_prefix must use lower-case letters, numbers and hyphens, and must not contain aws, amazon or cognito."
  }
}

variable "allowed_origins" {
  description = "Frontend origins (https://host, no trailing slash) allowed to receive the sign-in and sign-out redirects. Unknown until apply in dev, so it has no validation."
  type        = list(string)
}

variable "callback_path" {
  description = "Path appended to each allowed origin for the sign-in callback."
  type        = string
  default     = "/auth/callback"

  validation {
    condition     = startswith(var.callback_path, "/")
    error_message = "callback_path must start with /."
  }
}

variable "logout_path" {
  description = "Path appended to each allowed origin for the sign-out redirect."
  type        = string
  default     = "/"

  validation {
    condition     = startswith(var.logout_path, "/")
    error_message = "logout_path must start with /."
  }
}
