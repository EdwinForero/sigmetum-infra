variable "environment" {
  description = "Deployment environment: dev or prod. Forms the Beanstalk application and environment names."
  type        = string
}

variable "enable_cdn" {
  description = "Create a CloudFront distribution in front of Beanstalk (dev only — prod uses ALB with its own cert)"
  type        = bool
  default     = false
}

variable "solution_stack_name" {
  description = "EB platform. Use 'aws elasticbeanstalk list-available-solution-stacks' to find latest."
  type        = string
  default     = "64bit Amazon Linux 2023 v6.11.9 running Node.js 22"
}

variable "instance_type" {
  description = "EC2 instance type of the Beanstalk instances."
  type        = string
  default     = "t3.nano"
}

variable "min_instances" {
  description = "Minimum number of instances in the Auto Scaling group."
  type        = number
  default     = 1
}

variable "max_instances" {
  description = "Maximum number of instances in the Auto Scaling group."
  type        = number
  default     = 3
}

variable "vpc_id" {
  description = "ID of the VPC where the environment is deployed."
  type        = string
}

variable "subnet_ids" {
  description = "Subnets for the instances and the load balancer."
  type        = list(string)
}

# "single" = no LB (dev, saves ~€17/month)
# "application" = ALB with auto scaling (prod)
variable "load_balancer_type" {
  description = "'single' (no load balancer, dev) or 'application' (ALB with auto scaling, prod)."
  type        = string
  default     = "application"

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
  description = "Email address that receives the SNS notifications of the environment."
  type        = string
}

variable "app_env_vars" {
  description = "Non-secret application environment variables passed to the Node.js process. Must define every non-secret key the backend requires at startup; extra keys are allowed. JWT_SECRET, EMAIL_PASSWORD and ADMIN_PASSWORD live in Parameter Store and must not be set here."
  type        = map(string)
  sensitive   = true
  default     = {}

  validation {
    condition = alltrue([
      for key in ["JWT_EXPIRATION", "ADMIN_USERNAME", "EMAIL", "AWS_REGION", "AWS_BUCKET_NAME", "ALLOWED_ORIGIN"] : contains(keys(var.app_env_vars), key)
    ])
    error_message = "app_env_vars must define the keys the backend requires at startup: JWT_EXPIRATION, ADMIN_USERNAME, EMAIL, AWS_REGION, AWS_BUCKET_NAME and ALLOWED_ORIGIN."
  }

  validation {
    condition = !anytrue([
      for key in ["JWT_SECRET", "EMAIL_PASSWORD", "ADMIN_PASSWORD"] : contains(keys(var.app_env_vars), key)
    ])
    error_message = "app_env_vars must not define JWT_SECRET, EMAIL_PASSWORD or ADMIN_PASSWORD: they are delivered from Parameter Store (see the secrets procedure in the security guide and docs/integracion/para-backend.md)."
  }
}
