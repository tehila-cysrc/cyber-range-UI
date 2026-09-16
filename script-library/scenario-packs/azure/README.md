# Azure Pack

Safe Azure-oriented checks on already-provisioned VMs (discovery model — no Terraform here).

## Inject / script sequence

| Order | Script | Purpose |
| ---: | --- | --- |
| 1 | `cloud-az-vm-metadata` | Confirm VM identity via IMDS |
| 2 | `health-internet-access` | Egress / DNS baseline |
| 3 | `qradar-win-pipeline-probe` or Linux twin | SIEM path from this VM |
| 4 | `user-create-temp-file` | Host activity on Azure VM |

## Notes

- Does not create Azure resources
- Run Command already proves control plane → guest
- Pair with Bastion access for student investigation
