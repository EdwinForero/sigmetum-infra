terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Profile is passed via AWS_PROFILE=sigmetum-preprod — see docs/aws-cli-setup.md
provider "aws" {
  region = "eu-west-1"

  default_tags {
    tags = {
      Project     = "sigmetum"
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}
