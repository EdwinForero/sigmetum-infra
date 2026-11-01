# Remote state stored in the preprod account's S3 bucket.
# The bucket is created and hardened manually once: see docs/aws-organizations-setup.md, section 5.
# Run with: AWS_PROFILE=sigmetum-preprod terraform init
# Existing environments apply this change with: terraform init -reconfigure (see docs/guias/mantenimiento.md).

terraform {
  backend "s3" {
    bucket       = "sigmetum-tfstate-dev"
    key          = "terraform.tfstate"
    region       = "eu-west-3"
    encrypt      = true
    use_lockfile = true
  }
}
