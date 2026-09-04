# tflint configuration.
#
# The AWS ruleset is the part that earns its keep: it catches invalid instance
# types, malformed ARNs and deprecated arguments at lint time rather than eight
# minutes into an apply.
#
# Only rules NOT already in preset "recommended" are declared below. An earlier
# version of this file also re-declared terraform_required_providers,
# terraform_required_version and terraform_unused_declarations, each with a
# comment explaining why it mattered — all three are in the preset already, so
# every one of those blocks was a no-op dressed up as a decision.
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

# In preset "all" but not "recommended", so these two are the only rules this
# file actually adds. Every variable and output here is documented today;
# enforcing it stops the next one from shipping without.
rule "terraform_documented_variables" {
  enabled = true
}

rule "terraform_documented_outputs" {
  enabled = true
}
