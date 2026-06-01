variable "zone_name" {
  description = "Route53 hosted zone name (e.g. sigmetum-a.org)"
  type        = string
  default     = "sigmetum-a.org"
}

variable "backend_cname_target" {
  description = "EB environment CNAME to point backend.sigmetum-a.org at"
  type        = string
}
