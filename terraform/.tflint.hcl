# tflint configuration.
#
# The AWS ruleset is the part that earns its keep: it catches invalid instance
# types, malformed ARNs and deprecated arguments at lint time rather than eight
# minutes into an apply. The core rules below are the ones that matter for a
# config other people read.
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

plugin "aws" {
  enabled = true
  version = "0.44.0"
  source  = "github.com/terraform-linters/tflint-ruleset-aws"
}

# Every variable and output in this config has one. Enforcing it stops the
# next one from shipping without.
rule "terraform_documented_variables" {
  enabled = true
}

rule "terraform_documented_outputs" {
  enabled = true
}

# Unpinned providers are how a `terraform init` six months from now silently
# picks up a major version and breaks. versions.tf pins both; this keeps it so.
rule "terraform_required_providers" {
  enabled = true
}

rule "terraform_required_version" {
  enabled = true
}

# On, and it passes today. Worth knowing why it is safe here: this rule flags
# variables and locals nothing references, and the Makefile passing -var on the
# CLI does NOT count as a reference. Every variable in variables.tf is read by
# a resource, so the rule has nothing to say — but if someone adds a knob and
# wires it only into the Makefile, this is what catches it.
rule "terraform_unused_declarations" {
  enabled = true
}
