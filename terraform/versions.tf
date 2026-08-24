# Terraform and provider versions.
#
# STATE IS LOCAL, deliberately. A real team uses an S3 backend with DynamoDB
# locking so two people cannot apply at once and the state survives a laptop
# dying. Neither risk exists here: this cluster lives for three days and exactly
# one person applies to it. The honest boundary to state in an interview is that
# local state means terraform.tfstate is the only record of what exists — lose
# it and `make destroy` cannot find the resources it is meant to delete, which
# is exactly when `make check-orphans` stops being paranoia.
terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }

  }
}

provider "aws" {
  region = var.region

  # Every resource gets these without repeating them. Cost allocation works off
  # tags, so a burst cluster that tags nothing is one you cannot afterwards ask
  # "what did that actually cost me" about.
  default_tags {
    tags = {
      Project     = "vesselmind"
      Environment = "burst"
      ManagedBy   = "terraform"
      Phase       = "9"
    }
  }
}
