variable "environment" {
  type = string
}

variable "solution_stack_name" {
  description = "EB platform. Use 'aws elasticbeanstalk list-available-solution-stacks' to find latest."
  type        = string
  default     = "64bit Amazon Linux 2023 v6.4.0 running Node.js 20"
}

variable "instance_type" {
  type    = string
  default = "t3.nano"
}

variable "min_instances" {
  type    = number
  default = 1
}

variable "max_instances" {
  type    = number
  default = 3
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

# "single" = no LB (dev, saves ~€17/month)
# "application" = ALB with auto scaling (prod)
variable "load_balancer_type" {
  type    = string
  default = "application"

  validation {
    condition     = contains(["single", "application"], var.load_balancer_type)
    error_message = "load_balancer_type must be 'single' or 'application'."
  }
}

variable "ssl_certificate_arn" {
  description = "ACM certificate ARN for HTTPS (port 443). Required when load_balancer_type = application."
  type        = string
  default     = ""
}

# Leave empty to disable SSH entirely (recommended for production)
variable "ssh_key_name" {
  description = "EC2 key pair name for SSH access. Leave empty to disable SSH."
  type        = string
  default     = ""
}

variable "ssh_allowed_cidrs" {
  description = "CIDRs allowed to SSH. Only applies when ssh_key_name is set."
  type        = list(string)
  default     = []
}

variable "notification_email" {
  type = string
}

variable "app_env_vars" {
  description = "Application environment variables passed to the Node.js process."
  type        = map(string)
  sensitive   = true
  default     = {}
}
