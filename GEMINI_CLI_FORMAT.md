 <state_snapshot>
      <overall_goal>
          Refine the Analytics system, implement a robust Vertex AI REST bridge, and refactor the massive app-router-core.js into specialized sub-services.
      </overall_goal>


      <active_constraints>
           - Staff Privacy: Never track Admin or Agent activity.
           - Asset Locality: Zero dependency on external CDNs.
           - Vertex AI Requirement: Advanced image editing restricted to GCP Vertex AI REST.
           - Modularity: Sub-services must keep frontend router logic manageable.
      </active_constraints>


      <key_knowledge>
           - Massive Refactor: app-router-core.js reduced from 3000+ lines to ~180 lines.
           - Service Architecture: Feature logic now resides in 12 specialized *-ui-service.js files.
           - API Consistency: All new UI services now default to /api/v1/ endpoints.
      </key_knowledge>


      <artifact_trail>
           - src/js/appearance-ui-service.js: Created for branding/hero logic.
           - src/js/maintenance-ui-service.js: Created for backups/stats.
           - src/js/newsletter-ui-service.js: Created for subscribers/campaigns.
           - src/js/email-ui-service.js: Created for log monitoring.
           - src/js/media-ui-service.js: Created for media library management.
           - src/js/profile-ui-service.js: Created for agent profile management.
           - src/js/social-ui-service.js: Created for AI social inbox.
           - src/js/app-router-core.js: Fully refactored and modularized.
           - src/js/app-router.js: Cleaned up to reflect new architecture.
      </artifact_trail>


      <task_state>
           1. [DONE] Implement Vertex AI REST bridge for Image Editing.
           2. [DONE] Canonicalize 404 paths in Analytics.
           3. [DONE] Implement Local Flag Proxy/Cache (No-CDN).
           4. [DONE] Implement server-side pagination for Activity Timeline.
           5. [DONE] Refactor app-router-core.js (Major feat).
           6. [DONE] Finalize Appearance section extraction.
           7. [TODO] Implement Dark Mode support for Analytics charts and map.
      </task_state>
  </state_snapshot>

