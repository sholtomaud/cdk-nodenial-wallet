# Secure Static Website with AWS CDK (No WAF)

This project deploys a static website using AWS CDK, hosted on S3 and distributed via CloudFront, with a custom domain managed by Route 53 and an ACM certificate for HTTPS. This version **does not** include AWS WAF for cost considerations.

## Architecture
- **Amazon S3**: Stores the static website content (HTML, CSS, JavaScript, images).
- **Amazon CloudFront**: Acts as a Content Delivery Network (CDN) to cache and serve website content globally, improving performance and reducing latency. It's configured with an Origin Access Identity (OAI) to restrict direct access to the S3 bucket.
- **AWS Certificate Manager (ACM)**: Provides an SSL/TLS certificate to enable HTTPS for the custom domain.
- **Amazon Route 53**: Manages the DNS for the custom domain, pointing it to the CloudFront distribution.

## Security Considerations (Denial of Wallet without AWS WAF)

Deploying a static website on AWS S3 and CloudFront provides a good baseline of security and availability. However, without AWS WAF, there are specific considerations regarding "Denial of Wallet" (DoW) attacks, where an attacker attempts to generate excessive costs.

**Mitigations in Place:**
- **Origin Access Identity (OAI)**: CloudFront uses an OAI to access the S3 bucket. This prevents direct public access to the S3 bucket, ensuring that all traffic must go through CloudFront. This protects your S3 costs from direct hits.
- **AWS Shield Standard**: Your AWS account automatically benefits from AWS Shield Standard. This service provides protection against many common network and transport layer DDoS attacks (e.g., SYN floods, UDP reflection attacks) that target your CloudFront distribution. There is no additional charge for Shield Standard.
- **CloudFront Caching**: By caching your static content at Edge Locations, CloudFront reduces the number of requests to your S3 origin, which can help mitigate costs from certain types of traffic.

**Limitations and Risks without AWS WAF:**
- **No Application-Layer Filtering**: AWS WAF provides rules to inspect web requests for malicious patterns (like XSS, SQL injection - though SQLi is less relevant for static sites) and filter them out. Without WAF, you are more exposed to application-layer attacks if your frontend code has vulnerabilities or interacts with other APIs.
- **Vulnerability to Sophisticated Bots and Targeted Attacks**: While Shield Standard handles large-scale DDoS, more sophisticated bots or targeted attacks designed to generate high request volumes (even if the requests are for valid content) can still lead to increased CloudFront data transfer and request costs. WAF's rate-based rules and managed rule sets (like Amazon IP Reputation List) are specifically designed to counter these.
- **Higher Risk of Bill Shock**: Without the granular request inspection and blocking capabilities of WAF, there's a higher inherent risk that unexpected traffic spikes (malicious or not) could lead to a surprisingly high AWS bill.

**Recommendations to Further Mitigate DoW Risks:**
1.  **AWS Budgets**: Configure AWS Budgets to alert you when your costs exceed predefined thresholds. This won't stop an attack but will provide early notification of unusual spending.
2.  **CloudWatch Alarms**:
    - Set alarms on key CloudFront metrics:
        - `Requests`: Monitor for unusual spikes in the number of requests.
        - `BytesDownloaded`: Track data transfer out, a primary cost driver.
        - `4xxErrorRate` and `5xxErrorRate`: Spikes can indicate attack attempts or issues.
    - Set alarms on S3 bucket metrics like `GetRequests` (though most should come via CloudFront).
3.  **Regularly Review Logs**:
    - Enable and periodically review CloudFront access logs. Store them in a separate S3 bucket.
    - Enable and review S3 server access logs if needed, though CloudFront logs are usually more relevant for traffic analysis.
4.  **CloudFront Geo-restrictions**: If your website targets a specific geographic audience, configure CloudFront geo-restrictions to block traffic from other regions known for malicious activity.
5.  **Implement Strong Cache-Control Headers**: Ensure your static assets have appropriate `Cache-Control` headers to maximize caching by browsers and CloudFront, reducing origin fetches.

## Deployment

Before deploying, you **must** update placeholder values in the CDK code:
1.  Open `bin/app.ts`:
    - Update `hostedZoneIdPlaceholder` with your actual Route 53 Hosted Zone ID.
    - Update `domainNamePlaceholder` with your desired domain (e.g., `example.com`).
    - Update `subdomainPlaceholder` with your desired subdomain (e.g., `www`).
    - Optionally, update `awsAccount` and `awsRegion` if not using default environment settings.
2.  Open `lib/static-site-stack.ts`:
    - Review and update the `certificateValidationRegion` if needed (defaults to `us-east-1` for CloudFront edge certificates).

**Deployment Commands:**
```bash
# Install dependencies (if you haven't already)
npm install

# Bootstrap your AWS environment (only needed once per environment)
cdk bootstrap aws://ACCOUNT-ID/REGION # Replace ACCOUNT-ID and REGION

# Synthesize the CloudFormation template
cdk synth

# Deploy the stack
cdk deploy
```

Remember to manage your DNS records in Route 53 according to your domain registrar's requirements. The ACM certificate validation will also typically require you to add CNAME records to your DNS zone.
