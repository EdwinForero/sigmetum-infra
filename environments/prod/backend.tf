terraform {
  backend "s3" {
    bucket = "sigmetum-tfstate"
    key    = "prod/terraform.tfstate"
    region = "eu-west-3"
  }
}
