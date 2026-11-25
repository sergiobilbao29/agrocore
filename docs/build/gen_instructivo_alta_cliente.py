# -*- coding: utf-8 -*-
"""Instructivo 'Alta de cliente nuevo (instancia)' en PDF (estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem, Preformatted)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Alta-Cliente-Nuevo.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
CODE_BG = colors.HexColor("#0f172a"); SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=22, textColor=G900, spaceAfter=2, leading=26)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_code  = S("code", fontName="Courier-Bold", fontSize=9, textColor=colors.white, leading=13)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def code(txt):
    p = Preformatted(txt, st_code)
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),CODE_BG),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8),
        ("ROUNDEDCORNERS",[4,4,4,4])]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16, bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo técnico")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page); canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Alta de cliente nuevo (instancia separada)", st_title))
    E.append(Paragraph("Crear un sistema independiente para un cliente, como Bocco / Bovio / Borghi", st_sub))
    E.append(Paragraph(
        "Cada cliente corre en su <b>propia instancia</b>: carpeta, base de datos y subdominio propios. "
        "El script <b>Crear-Cliente.ps1</b> hace casi todo (clona el repo, crea la base, el .env con su puerto, "
        "instala, corre las migraciones y deja el lanzador). Después quedan 2 pasos manuales (DNS + túnel).", st_intro))
    E.append(callout("<b>Puertos en uso:</b> Demo 3100 &nbsp;|&nbsp; Borghi 3101 &nbsp;|&nbsp; Bovio 3102 &nbsp;|&nbsp; Bocco 3103. "
                     "El <b>siguiente libre es 3104</b>. Anotá cada nuevo puerto para no repetirlo.", BLUE_BG, BLUE_BD, BLUE_TX))
    E.append(callout("<b>Nombre sin ene con tilde:</b> para la carpeta, la base y el subdominio usá el nombre <b>sin la n con "
                     "tilde</b> (ej: <b>Mascareno</b>), porque la n con tilde da problemas en PostgreSQL y en el DNS. El nombre "
                     "con tilde (Mascareño) lo ponés adentro del sistema al crear la empresa.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("Antes de empezar", st_h2))
    E.append(steps([
        "Tené <b>publicada la última versión</b> del sistema (corré los scripts Subir-Version pendientes). La instancia nueva se crea con lo que esté en el repo, así arranca al día.",
        "Elegí el <b>nombre técnico sin espacios ni tildes</b> (ej: Mascareno) y el <b>puerto libre</b> (ej: 3104).",
    ]))

    E.append(Paragraph("Paso 1 - Crear la instancia", st_h2))
    E.append(Paragraph("Desde PowerShell (parado en C:\\AgroCore), corré:", st_step))
    E.append(code('powershell -ExecutionPolicy Bypass -File C:\\AgroCore\\_dev\\Crear-Cliente.ps1 `\n  -Cliente "Mascareno" -Puerto 3104'))
    E.append(Paragraph("Esto crea la carpeta <b>C:\\AgroCore-Mascareno</b>, la base <b>agrocore_mascareno</b>, "
                       "instala, migra y deja andando <b>http://localhost:3104/app</b>.", st_step))

    E.append(Paragraph("Paso 2 - DNS + túnel (Cloudflare)", st_h2))
    E.append(Paragraph("Usamos el mismo túnel de Demo (no se crea uno nuevo). El propio script te imprime estos pasos:", st_step))
    E.append(Paragraph("<b>a)</b> Apuntar el subdominio al túnel existente:", st_step))
    E.append(code('cloudflared tunnel route dns agrocore-demo mascareno.agrocore.ar'))
    E.append(Paragraph("<b>b)</b> Editar <b>C:\\Users\\sergi\\.cloudflared\\config.yml</b> y agregar bajo <b>ingress:</b> "
                       "(ANTES del catch-all 404):", st_step))
    E.append(code('    - hostname: mascareno.agrocore.ar\n      service: http://localhost:3104'))
    E.append(Paragraph("<b>c)</b> Reiniciar el túnel (Ctrl+C donde esté corriendo y volver a arrancar):", st_step))
    E.append(code('cloudflared tunnel run agrocore-demo'))
    E.append(Paragraph("<b>d)</b> Probar en el navegador: <b>https://mascareno.agrocore.ar/app</b>", st_step))

    E.append(Paragraph("Paso 3 - Configuración inicial (dentro del sistema)", st_h2))
    E.append(steps([
        "La base arranca vacía. Entrá como <b>admin</b> con el usuario del seed inicial.",
        "Creá la <b>empresa</b> (acá sí con el nombre real, ej: Mascareño), cargar CUIT y datos.",
        "Da de alta <b>usuarios y roles</b>, <b>campos y lotes</b>, catálogos (categorías de animales, artículos), cuentas bancarias, etc.",
        "Si factura por ARCA, cargar los datos de ARCA en Configuración; si es informal, dejalo en modo sin ARCA.",
    ]))

    E.append(Paragraph("Mantenimiento", st_h2))
    E.append(Paragraph("Para actualizar la instancia más adelante, es el mismo <b>Update-AgroCore.ps1</b> que las demás, "
                       "corriéndolo <b>dentro de C:\\AgroCore-Mascareno</b> (hace git pull + prisma migrate deploy + restart).", st_faq_a))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("El puerto elegido está ocupado.", "Corré el script con otro puerto: -Puerto 3105 (y sumando de a uno). Anotá cuál le diste a cada cliente."),
        ("Se cortó el script a la mitad.", "Volvé a correr el mismo comando: detecta la carpeta y entra en modo RESUME, salteando lo ya hecho."),
        ("El subdominio no abre.", "Revisá que agregaste el hostname en config.yml ANTES del catch-all 404 y que reiniciaste el túnel. Probá primero http://localhost:PUERTO/app."),
        ("¿Cómo le pongo la n con tilde al nombre?", "Solo en el nombre de la EMPRESA dentro del sistema. La carpeta/base/subdominio van sin tilde."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    doc.build(E); print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
