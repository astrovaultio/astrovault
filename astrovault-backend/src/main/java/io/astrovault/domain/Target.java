package io.astrovault.domain;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;

@Entity
public class Target extends PanacheEntity {
    public String name;
    @Enumerated(EnumType.STRING)
    public TargetType type;
    public Double ra;
    public Double dec;
    public String notes;
}
