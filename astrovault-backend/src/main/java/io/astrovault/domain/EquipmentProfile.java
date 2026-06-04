package io.astrovault.domain;

import io.quarkus.hibernate.orm.panache.PanacheEntity;
import jakarta.persistence.Entity;

@Entity
public class EquipmentProfile extends PanacheEntity {
    public String camera;
    public String telescope;
    public String mount;
    public String filter;
    public String focuser;
}
