# -*- coding: utf-8 -*-
"""Instructivo 'Primeros pasos / Puesta en marcha' en PDF (estilo AgroCore).
Guia de configuracion inicial para el usuario que arranca una empresa nueva."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem, Preformatted)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Puesta-en-Marcha.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
CODE_BG = colors.HexColor("#0f172a"); SLATE = colors.HexColor("#475569")
STEPNUM_BG = colors.HexColor("#16a34a")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=22, textColor=G900, spaceAfter=2, leading=26)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13, textColor=colors.white, leading=16)
st_step  = S("step", fontName="Helvetica", fontSize=10.3, textColor=colors.HexColor("#111827"), leading=15.5)
st_code  = S("code", fontName="Courier-Bold", fontSize=9, textColor=colors.white, leading=13)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)
st_cell  = S("cell", fontName="Helvetica", fontSize=9.5, textColor=colors.HexColor("#1f2937"), leading=13)
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9.5, textColor=G900, leading=13)

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

def paso(n, titulo, ruta, cuerpo_flowables):
    """Encabezado de paso: numero verde + titulo + ruta del menu, y luego el cuerpo."""
    num = Paragraph(str(n), S("pn", fontName="Helvetica-Bold", fontSize=13, textColor=colors.white, alignment=1, leading=16))
    tit = Paragraph(titulo, S("pt", fontName="Helvetica-Bold", fontSize=12.5, textColor=G900, leading=15))
    head = Table([[num, tit]], colWidths=[9*mm, 156*mm])
    head.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(0,0),STEPNUM_BG),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(0,0),0),("RIGHTPADDING",(0,0),(0,0),0),
        ("LEFTPADDING",(1,0),(1,0),8),
        ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
        ("ROUNDEDCORNERS",[3,3,3,3]),
    ]))
    out = [Spacer(1,7), head]
    if ruta:
        out.append(Spacer(1,2))
        out.append(Paragraph(f"<font color='#15803d'><b>Dónde:</b></font> {ruta}", S("ruta", fontName="Helvetica-Oblique", fontSize=9.5, textColor=SLATE, leading=13)))
    out.append(Spacer(1,3))
    out.extend(cuerpo_flowables)
    return out

def steps(items):
    return ListFlowable(
        [ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.3, spaceBefore=1, spaceAfter=1)

def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletColor=G600, leftIndent=16, bulletFontSize=8, spaceBefore=1, spaceAfter=1)

def P(t): return Paragraph(t, st_step)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Guía de puesta en marcha")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page); canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []

    E.append(Paragraph("Primeros pasos en AgroCore", st_title))
    E.append(Paragraph("Guía de puesta en marcha: dejá tu empresa lista para empezar a operar", st_sub))
    E.append(Paragraph(
        "Esta guía te lleva de la mano por las configuraciones iniciales, en el orden recomendado. "
        "Hacé cada paso una sola vez al principio y después ya cargás el día a día (compras, ventas, "
        "movimientos, viajes, etc.). No hace falta completar TODO para empezar: lo mínimo es la empresa, "
        "un usuario, las cajas/bancos y los campos. El resto lo vas sumando cuando lo necesites.", st_intro))

    E.append(callout("<b>Antes de entrar:</b> vas a usar el usuario que te entregamos "
                     "(por ejemplo <b>super@agrocore.local</b> con clave <b>super123</b>). "
                     "Lo primero que conviene hacer es <b>cambiar esa clave</b> por una tuya "
                     "(Configuración &gt; tu usuario).", AMBER_BG, AMBER_BD, AMBER_TX))

    # ---- PASO 1 ----
    E += paso(1, "Ingresar al sistema", "Navegador web",
        [ steps([
            "Abrí el navegador (Chrome, Edge) y entrá a la dirección de tu empresa, por ejemplo <b>https://tuempresa.agrocore.ar/app</b>.",
            "Escribí tu <b>usuario</b> (email) y <b>clave</b>, y tocá <b>Ingresar</b>.",
            "Arriba a la izquierda vas a ver el <b>selector de empresa</b>: desde ahí elegís con cuál trabajás (útil si manejás varias).",
        ]) ])

    # ---- PASO 2 ----
    E += paso(2, "Crear y configurar tu empresa", "Administración &gt; Empresas  (y  Administración &gt; Configuración)",
        [ P("Esta es la base de todo. Los datos de la empresa salen después en facturas, órdenes de pago y reportes."),
          steps([
            "Entrá a <b>Empresas</b> y tocá <b>Nueva empresa</b> (o editá la que ya exista).",
            "Completá <b>Nombre</b>, <b>Razón social</b>, <b>CUIT</b>, <b>Condición frente al IVA</b> (Responsable Inscripto, Monotributo, etc.), <b>localidad</b> y <b>provincia</b>.",
            "Cargá el <b>logo</b> y el <b>email</b> de la empresa (se usan en los comprobantes que envíes).",
            "Guardá y, arriba, <b>seleccioná esa empresa</b> como la activa.",
          ]),
          Spacer(1,3),
          callout("<b>Facturas AFIP/ARCA:</b> si vas a emitir comprobantes fiscales, cargá los datos de ARCA "
                  "en <b>Configuración</b> (punto de venta, certificado). Si trabajás de manera <b>informal</b> "
                  "(sin factura electrónica), dejalo en <b>modo sin ARCA</b>: el sistema grisa/oculta todo lo "
                  "fiscal y podés usar igual compras, ventas, caja, stock y producción.", BLUE_BG, BLUE_BD, BLUE_TX),
        ])

    # ---- PASO 3 ----
    E += paso(3, "Usuarios y permisos", "Administración &gt; Roles y permisos  ·  Administración &gt; Usuarios",
        [ P("Definí quién entra y qué puede ver o modificar cada uno."),
          bullets([
            "<b>Roles y permisos:</b> ya vienen 4 roles listos: <b>Administrador</b> (todo), <b>Contable</b> "
            "(finanzas, ventas, compras, reportes), <b>Operaciones</b> (producción, stock, logística) y "
            "<b>Solo lectura</b>. Podés crear roles a medida marcando permisos.",
            "<b>Usuarios:</b> tocá <b>Nuevo usuario</b>, cargá su email y clave, y asignale un <b>rol</b> y la <b>empresa</b>.",
            "Opcional: podés <b>vincular un usuario a un Empleado o Chofer</b> para que vea solo lo suyo.",
          ]) ])

    # ---- PASO 4 ----
    E += paso(4, "Revisar los catálogos base", "Administración &gt; Catálogos",
        [ P("Los <b>catálogos</b> son las listas maestras del sistema: cereales, especies de animales, tipos de "
            "insumo, insumos, labores y unidades. <b>Ya vienen precargados</b> cuando se crea tu empresa."),
          steps([
            "Entrá a <b>Catálogos</b> y recorré las pestañas para conocer lo que hay.",
            "Agregá lo que uses y no esté (por ejemplo un insumo o una labor propia) con el botón de <b>agregar</b>.",
            "Podés desactivar lo que no uses para que no aparezca en los buscadores.",
          ]) ])

    # ---- PASO 5 ----
    E += paso(5, "Categorías y Familias (artículos)", "Administración &gt; Categorías y Familias",
        [ P("Es el <b>árbol</b> con el que se ordenan tus productos y servicios: una <b>familia madre</b> "
            "(Insumos, Cereales/Granos, Animales, Servicios y Labores, Otros) y sus <b>subcategorías</b>."),
          bullets([
            "La <b>primera vez que entrás</b>, el árbol se arma solo con una estructura estándar del agro. "
            "Vas a ver el mensaje 'Árbol de categorías inicializado'.",
            "Revisalo y ajustalo a tu operación: agregá, renombrá o mové familias y subcategorías.",
            "Este árbol es el que después filtra Stock, Movimientos y los buscadores de productos.",
          ]) ])

    # ---- PASO 6 ----
    E += paso(6, "Categorías de Gastos", "Administración &gt; Categorías de Gastos",
        [ P("Otro <b>árbol</b>, pero para clasificar los <b>gastos</b> (Categoría &gt; Familia &gt; Subfamilia). "
            "Se usa cada vez que cargás un <b>Movimiento diario</b> de dinero."),
          bullets([
            "Igual que el anterior, se <b>inicializa solo</b> la primera vez que entrás.",
            "Ajustalo a cómo te gusta ver tus gastos (combustible, sueldos, insumos, impuestos, etc.).",
          ]) ])

    # ---- PASO 7 ----
    E += paso(7, "Campos y lotes", "Producción &gt; Campos y lotes",
        [ P("Cargá la superficie que trabajás. Sirve para campañas, insumos, labores y reportes por lote."),
          steps([
            "Tocá <b>Nuevo campo</b> y ponele nombre y localidad.",
            "Dentro de cada campo, cargá los <b>lotes</b> con sus <b>hectáreas</b>.",
            "Si alquilás campos, después los vinculás en <b>Tesorería &gt; Arrendamientos</b>.",
          ]) ])

    # ---- PASO 8 ----
    E += paso(8, "Cajas de efectivo", "Tesorería &gt; Control de efectivo",
        [ P("Registrá tus <b>cajas físicas</b> (efectivo) para controlar entradas, salidas y saldo."),
          steps([
            "Agregá una <b>caja nueva</b> con su <b>nombre</b> (ej: Caja administración) y el <b>saldo inicial</b> con el que arranca.",
            "Podés tener varias cajas y hacer transferencias entre ellas.",
          ]) ])

    # ---- PASO 9 ----
    E += paso(9, "Bancos y tarjetas", "Tesorería &gt; Bancos",
        [ steps([
            "Tocá <b>Nueva cuenta</b> y cargá el <b>banco</b>, el <b>número de cuenta</b>, la <b>moneda</b> (pesos o dólares) y el <b>saldo inicial</b>.",
            "Si usás <b>tarjeta de crédito</b>, cargala con <b>Nueva tarjeta</b> en el mismo módulo.",
            "Repetí por cada cuenta que tengas.",
          ]),
          Spacer(1,3),
          callout("<b>Saldo inicial:</b> ponele el saldo que tiene HOY la cuenta o la caja. A partir de ahí, cada "
                  "movimiento que cargues (o importes del resumen del banco) actualiza el saldo solo.", BLUE_BG, BLUE_BD, BLUE_TX),
        ])

    # ---- PASO 10 ----
    E += paso(10, "Cotizaciones (si trabajás en dólares o kg novillo)", "Tesorería &gt; Cotizaciones",
        [ P("Si manejás dólares, euros o valores en granos/kg de novillo, acá está la tabla de cotizaciones "
            "que el sistema usa para convertir. Se actualiza automático, pero podés cargar un valor a mano cuando quieras.") ])

    # ---- PASO 11 ----
    E += paso(11, "Clientes y proveedores", "Ventas &gt; Clientes  ·  Compras &gt; Proveedores",
        [ P("Cargá tus contactos comerciales. No es obligatorio hacerlo todo de una: también podés crearlos "
            "al vuelo mientras cargás una venta o una compra."),
          bullets([
            "En <b>Clientes</b> y <b>Proveedores</b> usá <b>Nuevo</b> y cargá razón social y CUIT.",
            "Cuando importás comprobantes o cargás viajes, muchos contactos se dan de <b>alta solos</b>.",
          ]) ])

    # ---- PASO 12 ----
    E += paso(12, "Empleados", "RRHH &gt; Empleados",
        [ P("Si vas a llevar sueldos y planillas, cargá tu personal acá. Cada empleado tiene su <b>planilla</b> "
            "de ganancias, gastos y liquidación de sueldo (por mes, por día o por jornal).") ])

    # ---- PASO 13 ----
    E += paso(13, "Numeración de comprobantes (opcional)", "Administración &gt; Configuración",
        [ P("Si vas a emitir <b>órdenes de pago</b> o <b>recibos</b> numerados, definí desde qué número arrancan. "
            "Si recién empezás, podés dejar los valores por defecto.") ])

    # ---- LISTO ----
    E += paso(14, "Listo para operar", "",
        [ P("Con eso ya tenés la base. De acá en más es el día a día:"),
          bullets([
            "Cargá el <b>stock inicial</b> de tus productos e insumos (Stock &gt; Movimientos).",
            "Registrá el <b>día a día</b> del dinero en <b>Movimientos diarios</b>.",
            "Empezá con <b>Compras</b>, <b>Ventas</b>, <b>Viajes</b> y <b>Campañas</b> según tu actividad.",
            "Si tenés dudas, usá el <b>asistente</b> (botón de Mensajes/chat) que responde sobre el sistema.",
          ]) ])

    # ---- CHECKLIST ----
    E.append(Spacer(1, 10))
    E.append(Paragraph("Checklist de puesta en marcha", S("h2c", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceAfter=6, leading=17)))
    filas = [
        ["[  ]", "Empresa creada y seleccionada (nombre, CUIT, IVA, logo)"],
        ["[  ]", "ARCA configurado  -o-  modo sin ARCA elegido"],
        ["[  ]", "Usuario propio con su rol (y clave cambiada)"],
        ["[  ]", "Catálogos revisados"],
        ["[  ]", "Árbol de Categorías y Familias ajustado"],
        ["[  ]", "Árbol de Categorías de Gastos ajustado"],
        ["[  ]", "Campos y lotes cargados"],
        ["[  ]", "Cajas de efectivo con saldo inicial"],
        ["[  ]", "Cuentas de banco y tarjetas con saldo inicial"],
        ["[  ]", "Clientes / proveedores principales (o al vuelo)"],
        ["[  ]", "Empleados cargados (si lleva sueldos)"],
        ["[  ]", "Stock inicial cargado"],
    ]
    data = [[Paragraph(a, st_cellb), Paragraph(b, st_cell)] for a,b in filas]
    tbl = Table(data, colWidths=[14*mm, 151*mm])
    tbl.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f8fafc")),
        ("BOX",(0,0),(-1,-1),0.8,G100),
        ("INNERGRID",(0,0),(-1,-1),0.5,colors.HexColor("#e2e8f0")),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),8),("RIGHTPADDING",(0,0),(-1,-1),8),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    E.append(tbl)

    # ---- FAQ ----
    E.append(Spacer(1, 12))
    E.append(Paragraph("Preguntas frecuentes", S("h2f", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceAfter=4, leading=17)))
    faqs = [
        ("Me aparecen los catálogos vacíos.",
         "Avisale a soporte: en tu empresa hay que correr la carga de catálogos base una vez. Una vez cargados, "
         "los árboles de Categorías se completan solos al entrar a esas pantallas."),
        ("¿Puedo empezar a usarlo sin cargar todo?",
         "Sí. Lo mínimo es: empresa, tu usuario, una caja o banco, y los campos. El resto lo sumás cuando lo necesites."),
        ("Trabajo sin factura (informal). ¿Sirve igual?",
         "Sí. Elegí el modo sin ARCA: se oculta lo fiscal y usás compras, ventas, caja, stock, producción y reportes normalmente."),
        ("¿Cómo cambio mi contraseña?",
         "En Administración > Configuración, sobre tu usuario. Hacelo apenas entres la primera vez."),
        ("¿Puedo manejar varias empresas con el mismo usuario?",
         "Sí. Se cambian desde el selector de empresa (arriba a la izquierda). Cada una tiene sus propios datos."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E); print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
