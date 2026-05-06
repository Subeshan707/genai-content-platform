package com.genai.platform.config;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * Converts Cognito JWT claims to Spring Security authorities.
 * Maps Cognito groups to ROLE_* authorities for method security.
 */
public class CognitoJwtConverter implements Converter<Jwt, AbstractAuthenticationToken> {

    @Override
    public AbstractAuthenticationToken convert(Jwt jwt) {
        Collection<GrantedAuthority> authorities = extractAuthorities(jwt);
        return new JwtAuthenticationToken(jwt, authorities, extractUsername(jwt));
    }

    private Collection<GrantedAuthority> extractAuthorities(Jwt jwt) {
        List<GrantedAuthority> authorities = new ArrayList<>();

        // Extract from Cognito groups
        List<String> groups = jwt.getClaimAsStringList("cognito:groups");
        if (groups != null) {
            for (String group : groups) {
                authorities.add(new SimpleGrantedAuthority("ROLE_" + group.toUpperCase()));
            }
        }

        // Extract from custom:role claim (if set)
        String customRole = jwt.getClaimAsString("custom:role");
        if (customRole != null && !customRole.isBlank()) {
            authorities.add(new SimpleGrantedAuthority("ROLE_" + customRole.toUpperCase()));
        }

        // Default to CREATOR if no role found
        if (authorities.isEmpty()) {
            authorities.add(new SimpleGrantedAuthority("ROLE_CREATOR"));
        }

        return authorities;
    }

    private String extractUsername(Jwt jwt) {
        String username = jwt.getClaimAsString("cognito:username");
        if (username == null) {
            username = jwt.getClaimAsString("email");
        }
        if (username == null) {
            username = jwt.getSubject();
        }
        return username;
    }
}
